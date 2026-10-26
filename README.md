View is a tiny (**~1kib!**\*) interface library.

```js
import { free, html, make } from "./view.js";
```

```js
const Click = ({ n = 0 } = {}) =>
	html`<button onclick="${() => Click({ n: n + 1 })}">
		I've been clicked ${n} times.
	</button>`;

const click = document.getElementById("click");
make(click, Click()); // free(click);
```

_\*Minified and brotli'd._

---

View exports three functions. `html` is a tagged template that describes markup without creating any DOM. `make` renders a description into a host element, and it can be called again to update that element. `free` detaches a host from View so that it can be cleared or handed back to other code. The rest of the library is internal and should not be relied on.

The `html` tag returns a plain object that holds the template's static strings and its interpolated values. Nothing is parsed or inserted until `make` runs, so views can be built, passed around, and returned from functions without touching the page.

```js
import { html, make, free } from "./view.js";

const greeting = (name) => html`<p class="hello">Hello, ${name}!</p>`;

const host = document.getElementById("app");
make(host, greeting("Ada"));
```

The first call to `make` on a host empties that host and records it. Later calls on the same host compare the new view with the previous one and change only the parts whose values differ. The static markup is created once and never rebuilt, so the call below updates the existing paragraph's text rather than inserting a new element. `make` returns the host, which makes it convenient to chain.

```js
make(host, greeting("Grace"));
```

Inside element content, an interpolation can be a string, a number, another `html` template, an array of any of these, `null`, `undefined`, or a boolean. Strings and numbers become text. Nested templates are rendered in place. Arrays render each of their items in order, and `null`, `undefined`, and booleans render nothing, which makes conditional content straightforward.

```js
const List = (items) =>
	html`<ul>${items.map((item) => html`<li>${item}</li>`)}</ul>`;

const Status = ({ done }) =>
	html`<p>${done && html`<strong>Finished</strong>`}</p>`;
```

Arrays are matched by position, not by identity, because View has no concept of keys. When an item is removed from the middle of a list, the items after it are updated in place rather than moved, so any DOM state tied to a position, such as focus or the contents of an uncontrolled input, stays with that position and not with the data that used to occupy it. When a list shrinks, the trailing elements are removed. If your items carry their own state, keep that state in your data and render from it, rather than relying on the DOM to remember it.

Inside a tag, an interpolated attribute value can be the whole value or part of a larger string. When the whole value is a single interpolation, its type is preserved, so a boolean controls the attribute's presence. A value of `true` produces an attribute with an empty value, while `false`, `null`, and `undefined` remove the attribute entirely. Any other value is written as a string. Mixed values are concatenated.

```js
const Button = ({ active, ready }) =>
	html`<button class="btn ${active ? "on" : ""}" disabled="${!ready}">Save</button>`;
```

The `value`, `checked`, and `selected` attributes are handled differently. They are set as properties rather than attributes, so they reflect what the user has done to the element. The `value` property is written only when it differs from the current contents of the field, which avoids moving the caret while someone is typing. Other attributes are written only when their value has changed since the previous render.

Event handlers are declared with an attribute whose name begins with `on` or `on:`, such as `onclick` or `on:input`. The attribute's value must be a single interpolation holding a function. The listener is attached once, when the element is first created, and each later render replaces the function that it calls. The function is invoked with the element as `this` and receives the event as its argument. If the function returns an `html` template, that template is rendered in place of the template that contains the element, so a handler can update the view by returning a new one. Returning anything else does nothing.

```js
const Click = ({ n = 0 } = {}) =>
	html`<button onclick="${() => Click({ n: n + 1 })}">
		I've been clicked ${n} times.
	</button>`;

make(document.getElementById("click"), Click());
```

In this example the handler returns a fresh `Click` template with the same markup, so View updates the existing button and only the count changes. If a handler returns a template whose markup differs from the one already on the page, View removes the old nodes and builds the new ones.

Because a handler is replaced on each render, it always sees the values from the render that most recently produced it, which is usually what you want. A static attribute such as `onclick="doSomething()"` that contains no interpolation is not treated as a View event and is left as ordinary HTML. Event attributes must contain exactly one interpolation with no surrounding text, and any attribute whose name starts with `on`, including names such as `one`, is treated as an event by View, so avoid such names for ordinary attributes.

Interpolations are supported in element content and in attribute values. They are not supported inside `<script>`, `<style>`, or HTML comments, where the placeholder text is not converted into a binding.

Templates are compiled once per distinct template literal. The strings array that a tag receives is the same object every time the same literal is evaluated, and View uses that identity as a cache key, so writing `html` inside a loop or a render function costs only the first parse. Strings arrays that are built dynamically still work, but they are compiled separately each time they appear.

Components are ordinary functions that return `html` templates, and they take their inputs as arguments. A default parameter, as in the `Click` example above, gives a component a sensible starting state. Composition works by interpolating one component's output inside another's template, and updates travel through the same mechanism as everything else.

```js
const Page = ({ user }) =>
	html`<main>
		<h1>Welcome back, ${user.name}</h1>
		${Click({ n: user.clicks })}
	</main>`;

make(document.body, Page({ user: { name: "Ada", clicks: 3 } }));
```

When you no longer want View to manage an element, call `free` with it. This forgets the element's binding and empties it, so the element behaves as a plain DOM node again, and a later call to `make` on it starts fresh. Everything inside the host is removed, including the nodes View created and any you added yourself, along with their event listeners. If you need to keep any of them, move them out of the host before calling `free`.

```js
free(document.getElementById("click"));
```

View relies on browser APIs, including `<template>`, `TreeWalker`, and `Range`, so it runs in a browser document and is not suitable for rendering on a server or in Node without a DOM implementation. Because it works by comparing each interpolated value with the previous one, it has no virtual tree and no reconciliation step beyond positional matching, and the design is intentionally small. Applications that need keyed lists, portals, or transitions between views will need to build those on top of it.
