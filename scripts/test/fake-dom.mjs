// 화면 그리기 시험이 같이 쓰는 가짜 DOM: picker/dom.js 의 h 가 쓰는 만큼만. innerHTML 을 쓰면 시험이 실패한다(외부 글은 textContent 로만).
// 화면 파일보다 먼저 불러야 한다(시험 파일은 이것을 import 한 뒤 화면 파일을 await import 로 부른다).
export class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.kids = [];
    this.on = {};
    this.style = {};
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  toggleAttribute() {}
  append(...xs) { for (const x of xs) this.kids.push(typeof x === 'string' ? { text: x } : x); }
  replaceChildren(...xs) { this.kids = []; this.append(...xs); }
  addEventListener(ev, fn) { (this.on[ev] ||= []).push(fn); }
  get textContent() { return this.kids.map((k) => (k instanceof FakeNode ? k.textContent : k.text)).join(''); }
  set textContent(v) { this.kids = [{ text: String(v) }]; }
  setAttributeNS() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  get innerHTML() { throw new Error('innerHTML 은 쓰지 않는다'); }
  set innerHTML(v) { throw new Error('innerHTML 은 쓰지 않는다'); }
}
const byId = new Map();
globalThis.Node = FakeNode;
globalThis.window = { addEventListener() {} };
globalThis.document = {
  createElement: (t) => new FakeNode(t), createElementNS: (_, t) => new FakeNode(t), addEventListener() {}, querySelector: () => null,
  getElementById: (id) => (byId.has(id) || byId.set(id, new FakeNode('div')), byId.get(id)),
};
// 노드 나무를 한 줄로(배열·null 도 받는다)
export const walk = (n, out = []) => {
  if (n instanceof FakeNode) out.push(n), n.kids.forEach((k) => walk(k, out));
  else if (Array.isArray(n)) n.forEach((k) => walk(k, out));
  return out;
};
