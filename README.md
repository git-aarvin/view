View is a tiny interface library.

```js
const Click = ({ n = 0 } = {}) =>
	html`<button onclick="${() =>
		Click({ n: n + 1 })}">I've been clicked ${n} times.</button>`;

const click = document.getElementById("click");
make(click, Click());
/* free(click); */
```
