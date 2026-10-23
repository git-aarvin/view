const views = new WeakSet();
const roots = new WeakMap();
const cache = new WeakMap();
const live = new Set(["value", "checked", "selected"]);
const unsafe = new Set(["srcdoc"]);
const raw = new Set([
	"script",
	"style",
	"textarea",
	"title",
	"xmp",
	"iframe",
	"noembed",
	"noframes",
	"plaintext",
	"noscript",
]);
const CONTENT = Symbol("content");
const WAIT = Symbol("wait");
const key = `x${Math.random().toString(36).slice(2) || "0"}`;
const find = new RegExp(`${key}t(\\d+);`, "g");
const exact = new RegExp(`^${key}(\\d+);$`);
const report = error =>
	queueMicrotask(() => {
		throw error;
	});
const html = (strings, ...values) => {
	const view = Object.freeze({ strings, values });
	views.add(view);
	return view;
};
const scan = (node, path) => {
	const parts = [];
	let at = 0;
	for (const kid of [...node.childNodes]) {
		if (kid.nodeType === 3 && kid.data.includes(key)) {
			const nodes = kid.data.split(find).flatMap((bit, index) => {
				if (index % 2) {
					parts.push({
						kind: "child",
						path: [...path, at++],
						index: +bit,
					});
					return [new Comment()];
				}
				return bit ? (at++, [new Text(bit)]) : [];
			});
			kid.replaceWith(...nodes);
			continue;
		}
		if (kid.nodeType === 8 && kid.data.includes(key)) {
			const match = exact.exec(kid.data);
			if (match) {
				parts.push({
					kind: "child",
					path: [...path, at++],
					index: +match[1],
				});
				kid.replaceWith(new Comment());
			} else {
				parts.push({
					kind: "comment",
					path: [...path, at++],
					chunks: kid.data.split(find),
				});
			}
			continue;
		}
		if (kid.nodeType === 1) {
			[...kid.attributes]
				.filter(({ value }) => value.includes(key))
				.forEach(({ name, value, namespaceURI, localName }) => {
					if (namespaceURI) {
						kid.removeAttributeNS(namespaceURI, localName);
					} else kid.removeAttribute(name);
					parts.push({
						kind: "attribute",
						path: [...path, at],
						name,
						namespace: namespaceURI,
						local: localName,
						chunks: value.split(find),
					});
				});
			parts.push(
				...(kid.content?.nodeType === 11
					? scan(kid.content, [...path, at, CONTENT])
					: scan(kid, [...path, at])),
			);
		}
		at++;
	}
	return parts;
};
const forms = strings => {
	const list = [];
	let mode = "data";
	let tag = "";
	let rawTag = "";
	let quote = "";
	let closing = false;
	const finish = () => {
		if (!closing && raw.has(tag)) {
			mode = "raw";
			rawTag = tag;
		} else {
			mode = "data";
			rawTag = "";
		}
		tag = "";
		quote = "";
		closing = false;
	};
	for (let part = 0; part < strings.length; part++) {
		if (part) {
			if (mode === "data") {
				const before = strings[part - 1];
				if (before.endsWith("<") || before.endsWith("</")) {
					throw new SyntaxError(
						"View placeholders cannot be used as tag names",
					);
				}
				list.push("comment");
			} else if (
				mode === "comment" || mode === "raw" || mode === "value"
			) {
				list.push("text");
			} else if (mode === "beforeValue") {
				list.push("text");
				mode = "value";
				quote = "";
			} else {
				throw new SyntaxError(
					"View placeholders are only supported in text, comments, and attribute values",
				);
			}
		}
		const source = strings[part];
		for (let at = 0; at < source.length; at++) {
			const char = source[at];
			if (mode === "data") {
				if (char !== "<") continue;
				if (source.startsWith("<!-->", at)) {
					at += 4;
				} else if (source.startsWith("<!--->", at)) {
					at += 5;
				} else if (source.startsWith("<!--", at)) {
					mode = "comment";
					at += 3;
				} else if (
					source.startsWith("<!", at) || source.startsWith("<?", at)
				) {
					mode = "bogus";
					at += 1;
				} else if (
					source.startsWith("</", at)
					&& /[a-z]/i.test(source[at + 2] ?? "")
				) {
					mode = "tagName";
					closing = true;
					tag = "";
					at += 1;
				} else if (/[a-z]/i.test(source[at + 1] ?? "")) {
					mode = "tagName";
					closing = false;
					tag = "";
				}
				continue;
			}
			if (mode === "tagName") {
				if (char === ">") {
					finish();
				} else if (char === "/") {
					mode = "beforeAttr";
				} else if (/[\t\n\f\r ]/.test(char)) {
					mode = "beforeAttr";
				} else {
					tag += char.toLowerCase();
				}
				continue;
			}
			if (mode === "beforeAttr") {
				if (/[\t\n\f\r ]/.test(char) || char === "/") continue;
				if (char === ">") {
					finish();
				} else {
					mode = "attrName";
				}
				continue;
			}
			if (mode === "attrName") {
				if (/[\t\n\f\r ]/.test(char)) {
					mode = "afterAttrName";
				} else if (char === "=") {
					mode = "beforeValue";
				} else if (char === "/" || char === ">") {
					mode = "beforeAttr";
					at--;
				}
				continue;
			}
			if (mode === "afterAttrName") {
				if (/[\t\n\f\r ]/.test(char)) continue;
				if (char === "=") {
					mode = "beforeValue";
				} else if (char === "/" || char === ">") {
					mode = "beforeAttr";
					at--;
				} else {
					mode = "attrName";
				}
				continue;
			}
			if (mode === "beforeValue") {
				if (/[\t\n\f\r ]/.test(char)) continue;
				if (char === "\"" || char === "'") {
					mode = "value";
					quote = char;
				} else if (char === ">") {
					finish();
				} else {
					mode = "value";
					quote = "";
					at--;
				}
				continue;
			}
			if (mode === "value") {
				if (quote) {
					if (char === quote) {
						mode = "beforeAttr";
						quote = "";
					}
				} else if (/[\t\n\f\r ]/.test(char)) {
					mode = "beforeAttr";
				} else if (char === ">") {
					finish();
				}
				continue;
			}
			if (mode === "comment") {
				if (char === "-" && source.startsWith("-->", at)) {
					mode = "data";
					at += 2;
				} else if (char === "-" && source.startsWith("--!>", at)) {
					mode = "data";
					at += 3;
				}
				continue;
			}
			if (mode === "bogus") {
				if (char === ">") mode = "data";
				continue;
			}
			if (
				mode === "raw" && rawTag !== "plaintext" && char === "<"
				&& source[at + 1] === "/"
			) {
				const name = source.slice(at + 2, at + 2 + rawTag.length)
					.toLowerCase();
				const after = source[at + 2 + rawTag.length];
				if (
					name === rawTag
					&& (after === undefined || /[ \t\n\f\r/>]/.test(after))
				) {
					const end = source.indexOf(">", at + 2 + rawTag.length);
					if (end < 0) {
						at = source.length;
					} else {
						at = end;
						mode = "data";
						rawTag = "";
					}
				}
			}
		}
	}
	return list;
};
const parse = strings => {
	const kinds = forms(strings);
	const template = document.createElement("template");
	template.innerHTML = strings.reduce((text, bit, index) => {
		if (!index) return bit;
		const marker = index - 1;
		return `${text}${
			kinds[marker] === "comment"
				? `<!--${key}${marker};-->`
				: `${key}t${marker};`
		}${bit}`;
	});
	return {
		content: template.content,
		parts: scan(template.content, []),
	};
};
const compile = strings => {
	if (!cache.has(strings)) cache.set(strings, parse(strings));
	return cache.get(strings);
};
const sweep = (from, to) => {
	for (let at = from; at && at !== to;) {
		const next = at.nextSibling;
		at.remove();
		at = next;
	}
};
const retire = cell => {
	release(cell);
	cell.anchor.remove();
};
const release = slot => {
	const { held, anchor } = slot;
	if (Array.isArray(held)) held.forEach(cell => cell && retire(cell));
	else if (held?.nodeType) held.remove();
	else if (held && !held.pending) {
		if (held.slots) held.slots.forEach(release);
		sweep(held.head, anchor);
	}
	slot.held = null;
};
const syncTextarea = slot => {
	const parent = slot.anchor.parentNode;
	if (parent?.localName !== "textarea") return;
	const text = parent.textContent;
	if (parent.value !== text) parent.value = text;
};
const touch = slot => {
	syncTextarea(slot);
	if (slot.owner?.refresh) slot.owner.refresh();
};
const fill = (slot, value) => {
	if (typeof value?.then === "function") {
		const token = { pending: true };
		release(slot);
		slot.held = token;
		touch(slot);
		Promise.resolve(value).then(
			next => {
				if (slot.held === token) fill(slot, next);
			},
			report,
		).catch(report);
		return;
	}
	slot.held = place(slot, value);
	touch(slot);
};
const land = (owner, out) => {
	if (out === undefined || typeof out === "boolean") return;
	const token = ++owner.version;
	const settle = value => {
		if (owner.version !== token) return;
		if (typeof value?.then === "function") {
			Promise.resolve(value).then(settle).catch(report);
		} else if (
			value !== undefined
			&& typeof value !== "boolean"
			&& owner.slot.held === owner
		) {
			fill(owner.slot, value);
		}
	};
	settle(out);
};
const compose = (chunks, values) => {
	const waits = [];
	const parts = chunks.map((bit, index) => {
		if (!(index % 2)) return bit;
		const value = values[bit];
		if (typeof value?.then !== "function") {
			return value == null ? "" : String(value);
		}
		const part = { [WAIT]: waits.length };
		waits.push(Promise.resolve(value));
		return part;
	});
	if (!waits.length) return parts.join("");
	return Promise.all(waits).then(done =>
		parts
			.map(part =>
				part?.[WAIT] === undefined
					? part
					: String(done[part[WAIT]] ?? "")
			)
			.join("")
	);
};
const attribute = (
	element,
	{ name, namespace, local, chunks },
	owner,
) => {
	const custom = name.startsWith("on:") ? name.slice(3) : "";
	const standard = !custom && name.startsWith("on") && name in element
		? name.slice(2).toLowerCase()
		: "";
	const event = custom || standard;
	const solo = chunks.length === 3 && chunks[0] === ""
		&& chunks[2] === "";
	const after = name === "value" && element.localName === "select";
	if (unsafe.has(name.toLowerCase())) {
		throw new SyntaxError(
			"Dynamic srcdoc attributes are not supported",
		);
	}
	if (event && !solo) {
		throw new SyntaxError(
			"Event attributes must contain exactly one interpolation",
		);
	}
	const set = value =>
		namespace
			? element.setAttributeNS(namespace, name, value)
			: element.setAttribute(name, value);
	const remove = () =>
		namespace
			? element.removeAttributeNS(namespace, local)
			: element.removeAttribute(name);
	let previous;
	let handler;
	let listener;
	let token = 0;
	const applyValue = next => {
		if (event && typeof next === "function") {
			handler = next;
			if (!listener) {
				remove();
				listener = event => {
					const out = handler?.call(element, event);
					if (out === false) event.preventDefault();
					land(owner, typeof out === "boolean" ? undefined : out);
				};
				element.addEventListener(event, listener);
			}
			previous = next;
			return;
		}
		if (listener) {
			element.removeEventListener(event, listener);
			listener = null;
			handler = null;
		}
		if (event) {
			remove();
			return;
		}
		const present = next != null && next !== false;
		const property = live.has(name) && name in element;
		const active = name === "value"
			? next != null
			: property
			? Boolean(next)
			: present;
		if (property) {
			if (name === "value") {
				const value = next == null ? "" : String(next);
				if (element.value == null || String(element.value) !== value) {
					element.value = value;
				}
			} else if (element[name] !== active) {
				element[name] = active;
			}
		}
		const value = !active
			? null
			: name === "value"
			? String(next)
			: next === true
			? ""
			: String(next);
		if (value === previous) return;
		previous = value;
		if (value === null) remove();
		else set(value);
	};
	const apply = values => {
		const next = solo ? values[chunks[1]] : compose(chunks, values);
		const id = ++token;
		if (typeof next?.then === "function") {
			Promise.resolve(next).then(value => {
				if (token === id && owner.slot.held === owner) {
					applyValue(value);
					if (!after) owner.refresh?.();
				}
			}, report).catch(report);
			return;
		}
		applyValue(next);
	};
	if (after) apply.after = true;
	return apply;
};
const comment = (node, { chunks }, owner) => {
	let token = 0;
	const applyValue = next => {
		const text = next == null ? "" : String(next);
		if (node.data !== text) node.data = text;
	};
	return values => {
		const next = compose(chunks, values);
		const id = ++token;
		if (typeof next?.then === "function") {
			Promise.resolve(next).then(value => {
				if (token === id && owner.slot.held === owner) {
					applyValue(value);
					owner.refresh?.();
				}
			}, report).catch(report);
			return;
		}
		applyValue(next);
	};
};
const child = (node, index, owner) => {
	const slot = { anchor: node, held: null, owner };
	const apply = values => fill(slot, values[index]);
	apply.slot = slot;
	return apply;
};
const bind = (part, root, owner) => {
	const node = part.path.reduce(
		(at, index) =>
			index === CONTENT ? at.content : at.childNodes[index],
		root,
	);
	if (part.kind === "child") return child(node, part.index, owner);
	if (part.kind === "comment") return comment(node, part, owner);
	return attribute(node, part, owner);
};
const build = (slot, view) => {
	const { content, parts } = compile(view.strings);
	const root = content.cloneNode(true);
	const instance = {
		strings: view.strings,
		head: new Comment(),
		slot,
		version: 0,
		current: view.values,
		slots: [],
		batch: 0,
		dirty: false,
	};
	const binds = parts.map(part => bind(part, root, instance));
	const sync = binds.filter(apply => !apply.after);
	const later = binds.filter(apply => apply.after);
	instance.slots = binds.map(apply => apply.slot).filter(Boolean);
	instance.set = values => {
		instance.current = values;
		instance.version += 1;
		instance.batch += 1;
		try {
			sync.forEach(apply => apply(values));
			later.forEach(apply => apply(values));
		} finally {
			instance.batch -= 1;
		}
		if (instance.dirty) instance.refresh();
	};
	instance.refresh = () => {
		if (instance.slot.held !== instance) return;
		if (instance.batch) {
			instance.dirty = true;
			return;
		}
		instance.dirty = false;
		later.forEach(apply => apply(instance.current));
		syncTextarea(instance.slot);
		if (instance.slot.owner?.refresh) instance.slot.owner.refresh();
	};
	instance.set(view.values);
	root.prepend(instance.head);
	slot.anchor.before(root);
	return instance;
};
const place = (slot, value) => {
	const { held, anchor } = slot;
	if (views.has(value)) {
		if (held?.strings === value.strings) {
			held.set(value.values);
			return held;
		}
		release(slot);
		return build(slot, value);
	}
	if (Array.isArray(value)) {
		const list = Array.isArray(held) ? held : (release(slot), []);
		const cells = Array.from(value, (item, index) => {
			const cell = list[index]
				?? {
					anchor: anchor.parentNode.insertBefore(new Comment(), anchor),
					held: null,
					owner: slot.owner,
				};
			cell.owner = slot.owner;
			fill(cell, item);
			return cell;
		});
		for (let index = value.length; index < list.length; index++) {
			retire(list[index]);
		}
		return cells;
	}
	if (value == null || typeof value === "boolean") {
		release(slot);
		return null;
	}
	if (value?.nodeType === 11) return place(slot, [...value.childNodes]);
	if (value?.nodeType === 3) {
		if (held?.nodeType === 3) {
			if (held.data !== value.data) held.data = value.data;
			return held;
		}
		release(slot);
		anchor.before(value);
		return value;
	}
	if (value?.nodeType) {
		if (held === value) return held;
		release(slot);
		anchor.before(value);
		return value;
	}
	const text = String(value);
	if (held?.nodeType === 3) {
		if (held.data !== text) held.data = text;
		return held;
	}
	release(slot);
	const node = new Text(text);
	anchor.before(node);
	return node;
};
const make = (host, view) => {
	if (!roots.has(host)) {
		const anchor = new Comment();
		host.replaceChildren(anchor);
		roots.set(host, { anchor, held: null, owner: null });
	}
	fill(roots.get(host), view);
	return host;
};
const free = host => {
	const slot = roots.get(host);
	if (slot) {
		release(slot);
		slot.anchor.remove();
		roots.delete(host);
	}
	return host;
};
export { free, html, make };
