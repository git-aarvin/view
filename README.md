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
