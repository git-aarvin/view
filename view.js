const salt = "v" + Math.random().toString(36).slice(2);
const pattern = new RegExp(salt + "(\\d+);");
const cache = new WeakMap();
const roots = new WeakMap();
export const html = (strings, ...values) => ({ strings, values });
const nodes = (root) => {
	const walker = document.createTreeWalker(root, 129);
	const found = [];
	while (walker.nextNode()) found.push(walker.currentNode);
	return found;
};
const compile = (strings) => {
	let entry = cache.get(strings);
	if (entry) return entry;
	let source = "",
		inside = false;
	strings.forEach((piece, index) => {
		source += piece;
		const open = piece.lastIndexOf("<"),
			close = piece.lastIndexOf(">");
		if (open + close > -2) inside = open > close;
		if (index < strings.length - 1)
			source += inside ? `${salt}${index};` : `<!--${salt}${index}-->`;
	});
	const template = document.createElement("template");
	template.innerHTML = source;
	const children = [],
		attributes = [];
	nodes(template.content).forEach((node, index) => {
		if (node.nodeType === 8) {
			if (node.data.startsWith(salt))
				children.push({ index, which: +node.data.slice(salt.length) });
		} else {
			for (const { name, value } of [...node.attributes]) {
				if (!value.includes(salt)) continue;
				node.removeAttribute(name);
				attributes.push({ index, name, pieces: value.split(pattern) });
			}
		}
	});
	cache.set(
		strings,
		(entry = { template, parts: [...children, ...attributes] }),
	);
	return entry;
};
const mark = (anchor) =>
	anchor.parentNode.insertBefore(new Comment(), anchor);
const slot = (end) => ({ end, start: mark(end) });
const cut = (from, until) => {
	const range = new Range();
	range.setStartBefore(from);
	range.setEndBefore(until);
	range.deleteContents();
};
const clear = (target) => {
	cut(target.start.nextSibling, target.end);
	target.strings = target.update = target.items = target.text = null;
};
const fill = (target, value) => {
	if (value?.strings) {
		if (target.strings === value.strings) target.update(value.values);
		else
			(clear(target),
				(target.strings = value.strings),
				(target.update = build(target.end, value, target)));
	} else if (Array.isArray(value)) {
		if (!target.items) (clear(target), (target.items = []));
		value.forEach((item, index) =>
			fill((target.items[index] ??= slot(mark(target.end))), item),
		);
		const extra = target.items.splice(value.length);
		if (extra.length) cut(extra[0].start, target.end);
	} else if (value == null || typeof value === "boolean") clear(target);
	else {
		const text = "" + value;
		if (target.text) target.text.data = text;
		else
			(clear(target),
				target.end.before((target.text = new Text(text))));
	}
};
const bind = (node, { name, pieces, which }, owner) => {
	if (!pieces) {
		const target = slot(node);
		return (values) => fill(target, values[which]);
	}
	const kind = name.match(/^on:?(.+)/);
	if (kind) {
		let handler;
		node.addEventListener(kind[1], (event) => {
			const output = handler?.call(node, event);
			if (output?.strings) fill(owner, output);
		});
		return (values) => void (handler = values[pieces[1]]);
	}
	const solo = pieces.length === 3 && !pieces[0] && !pieces[2];
	let previous;
	return (values) => {
		const value = solo
			? values[pieces[1]]
			: pieces
					.map((piece, index) =>
						index % 2 ? (values[piece] ?? "") : piece,
					)
					.join("");
		if (name === "value") {
			const text = value == null ? "" : "" + value;
			if (node.value !== text) node.value = text;
		} else if (name === "checked" || name === "selected")
			node[name] = !!value;
		else if (value !== previous) {
			previous = value;
			if (value == null || value === false) node.removeAttribute(name);
			else node.setAttribute(name, value === true ? "" : value);
		}
	};
};
const build = (anchor, view, owner) => {
	const { template, parts } = compile(view.strings);
	const root = template.content.cloneNode(true);
	const found = nodes(root);
	const binds = parts.map((part) =>
		bind(found[part.index], part, owner),
	);
	const update = (values) => binds.forEach((apply) => apply(values));
	update(view.values);
	anchor.before(root);
	return update;
};
export const make = (host, view) => {
	let root = roots.get(host);
	if (!root) {
		host.replaceChildren(new Comment());
		roots.set(host, (root = slot(host.firstChild)));
	}
	fill(root, view);
	return host;
};
export const free = (host) => {
	roots.delete(host);
	host.replaceChildren();
	return host;
};
