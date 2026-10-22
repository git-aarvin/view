const views = new WeakSet();
const roots = new WeakMap();
const cache = new WeakMap();
const live = new Set(["value", "checked", "selected"]);
const raw = new Set([
	"script", "style", "textarea", "title", "xmp", "iframe",
	"noembed", "noframes", "plaintext", "noscript",
]);
const CONTENT = Symbol("content");
const key = `x${Math.random().toString(36).slice(2) || "0"}`;
const find = new RegExp(`${key}t(\\d+);`, "g");
const exact = new RegExp(`^${key}(\\d+);$`);
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
				.forEach(({ name, value }) => {
					kid.removeAttribute(name);
					parts.push({
						kind: "attribute",
						path: [...path, at],
						name,
						chunks: value.split(find),
					});
				});
			parts.push(...(kid.content?.nodeType === 11
				? scan(kid.content, [...path, at, CONTENT])
				: scan(kid, [...path, at])));
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
			} else if (mode === "comment" || mode === "raw" || mode === "value") {
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
				if (source.startsWith("<!--", at)) {
					mode = "comment";
					at += 3;
				} else if (source.startsWith("<!", at) || source.startsWith("<?", at)) {
					mode = "bogus";
					at += 1;
				} else if (source.startsWith("</", at) && /[a-z]/i.test(source[at + 2] ?? "")) {
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
				if (char === '"' || char === "'") {
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
				}
				continue;
			}
			if (mode === "bogus") {
				if (char === ">") mode = "data";
				continue;
			}
			if (mode === "raw" && rawTag !== "plaintext" && char === "<" && source[at + 1] === "/") {
				const name = source.slice(at + 2, at + 2 + rawTag.length).toLowerCase();
				const after = source[at + 2 + rawTag.length];
				if (name === rawTag && (after === undefined || /[ \t\n\f\r/>]/.test(after))) {
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
const fill = (slot, value) => {
	if (typeof value?.then === "function") {
		const token = { pending: true };
		release(slot);
		slot.held = token;
		Promise.resolve(value).then(
			next => {
				if (slot.held === token) fill(slot, next);
			},
			error => {
				if (slot.held === token) queueMicrotask(() => { throw error; });
			},
		).catch(error => queueMicrotask(() => { throw error; }));
		return;
	}
	slot.held = place(slot, value);
};
const land = (owner, out) => {
	const token = ++owner.version;
	const fail = error => {
		if (owner.version === token && owner.slot.held === owner) {
			queueMicrotask(() => { throw error; });
		}
	};
	const settle = value => {
		if (owner.version !== token) return;
		if (typeof value?.then === "function") {
			Promise.resolve(value).then(settle).catch(fail);
		} else if (value !== undefined && owner.slot.held === owner) {
			fill(owner.slot, value);
		}
	};
	settle(out);
};
const attribute = (element, { name, chunks }, owner) => {
	const event = name.startsWith("on") ? name.slice(2).toLowerCase() : "";
	const standard = event && name in element;
	const solo = chunks.length === 3 && chunks[0] === ""
		&& chunks[2] === "";
	if (standard && !solo) {
		throw new SyntaxError("Event attributes must contain exactly one interpolation");
	}
	let previous;
	let handler;
	let listener;
	const apply = values => {
		const next = solo
			? values[chunks[1]]
			: chunks.map((bit, index) => index % 2 ? values[bit] ?? "" : bit)
				.join("");
		if (event && typeof next === "function") {
			handler = next;
			if (!listener) {
				element.removeAttribute(name);
				listener = event => land(owner, handler?.call(element, event));
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
		const present = next != null && next !== false;
		const property = live.has(name) && name in element;
		const active = property && name !== "value"
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
		if (next === previous) return;
		previous = next;
		if (!active || standard) element.removeAttribute(name);
		else if (name === "value") element.setAttribute(name, String(next));
		else element.setAttribute(name, next === true ? "" : next);
	};
	if (name === "value" && element.localName === "select") apply.after = true;
	return apply;
};
const comment = (node, { chunks }) => values => {
	const next = chunks
		.map((bit, index) => index % 2 ? values[bit] ?? "" : bit)
		.join("");
	if (node.data !== next) node.data = next;
};
const child = (node, index) => {
	const slot = { anchor: node, held: null };
	const apply = values => fill(slot, values[index]);
	apply.slot = slot;
	return apply;
};
const bind = (part, root, owner) => {
	const node = part.path.reduce(
		(at, index) => index === CONTENT ? at.content : at.childNodes[index],
		root,
	);
	if (part.kind === "child") return child(node, part.index);
	if (part.kind === "comment") return comment(node, part);
	return attribute(node, part, owner);
};
const build = (slot, view) => {
	const { content, parts } = compile(view.strings);
	const root = content.cloneNode(true);
	const instance = { strings: view.strings, head: new Comment(), slot, version: 0 };
	const binds = parts.map(part => bind(part, root, instance));
	const sync = binds.filter(apply => !apply.after);
	const later = binds.filter(apply => apply.after);
	instance.slots = binds.map(apply => apply.slot).filter(Boolean);
	instance.set = values => {
		instance.version += 1;
		sync.forEach(apply => apply(values));
		later.forEach(apply => apply(values));
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
				};
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
		roots.set(host, { anchor, held: null });
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
