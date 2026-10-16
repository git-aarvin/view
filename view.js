const views = new WeakSet();
const roots = new WeakMap();
const cache = new WeakMap();
const live = new Set(["value", "checked", "selected"]);
const key = `x${Math.random().toString(36).slice(2)}`;
const find = new RegExp(`${key}(\\d+);`, "g");
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
			parts.push(...scan(kid, [...path, at]));
		}
		at++;
	}
	return parts;
};
const parse = strings => {
	const template = document.createElement("template");
	template.innerHTML = strings.reduce((text, bit, index) =>
		`${text}${key}${index - 1};${bit}`
	);
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
	if (Array.isArray(held)) held.forEach(retire);
	else if (held instanceof Text) held.remove();
	else if (held) sweep(held.head, anchor);
	slot.held = null;
};
const fill = (slot, value) => {
	slot.held = place(slot, value);
};
const land = (owner, out) => {
	if (views.has(out)) {
		if (owner.slot.held === owner) fill(owner.slot, out);
	} else if (typeof out?.then === "function") {
		out.then(next => land(owner, next));
	}
};
const attribute = (element, { name, chunks }, owner) => {
	if (name.startsWith("on")) {
		let handler;
		element.addEventListener(
			name.slice(2),
			event => land(owner, handler?.(event)),
		);
		return values => {
			const next = values[chunks[1]];
			handler = typeof next === "function" ? next : undefined;
		};
	}
	const solo = chunks.length === 3 && chunks[0] === ""
		&& chunks[2] === "";
	let previous;
	return values => {
		const next = solo
			? values[chunks[1]]
			: chunks.map((bit, index) => index % 2 ? values[bit] ?? "" : bit)
				.join("");
		if (live.has(name)) {
			element[name] = name === "value"
				? next ?? ""
				: Boolean(next);
		}
		if (next === previous) return;
		previous = next;
		if (next == null || next === false) element.removeAttribute(name);
		else element.setAttribute(name, next === true ? "" : next);
	};
};
const child = (node, index) => {
	const slot = { anchor: node, held: null };
	return values => fill(slot, values[index]);
};
const bind = (part, root, owner) => {
	const node = part.path.reduce(
		(at, index) => at.childNodes[index],
		root,
	);
	return part.kind === "child"
		? child(node, part.index)
		: attribute(node, part, owner);
};
const build = (slot, view) => {
	const { content, parts } = compile(view.strings);
	const root = content.cloneNode(true);
	const instance = { strings: view.strings, head: new Comment(), slot };
	const binds = parts.map(part => bind(part, root, instance));
	instance.set = values => binds.forEach(apply => apply(values));
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
		const cells = value.map((item, index) => {
			const cell = list[index]
				?? {
					anchor: anchor.parentNode.insertBefore(new Comment(), anchor),
					held: null,
				};
			fill(cell, item);
			return cell;
		});
		list.slice(value.length).forEach(retire);
		return cells;
	}
	if (value == null || typeof value === "boolean") {
		release(slot);
		return null;
	}
	const text = String(value);
	if (held instanceof Text) {
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
