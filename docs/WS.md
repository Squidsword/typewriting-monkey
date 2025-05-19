| Event          | Payload                               | When                                                   |
|----------------|---------------------------------------|--------------------------------------------------------|
| `cursor`       | `number`                              | After connection – absolute index of next char         |
| `init-words`   | `WordHit[]`                           | After connection – all words found so far              |
| `char`         | `{ index:number; ch:string }`         | Every generated character (rate = users×5 cpm)         |
| `word`         | `{ start:number; len:number; word }`  | When detector finds a new word                        |

WordHit shape:
```ts
interface WordHit { start:number; len:number; word:string }
```

Client example
```ts
import io from "socket.io-client";
const sock = io({ path: "/ws", transports: ["websocket"] });
sock.on('char', ({ index, ch }: CharEvt) => { ...
```