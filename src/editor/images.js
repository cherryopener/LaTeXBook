// 그림 붙여넣기·끌어다 놓기 — 파일을 올리는 동안 원고는 그대로 두고, 올림이 끝나면 처음 놓은 자리에 ::fig 를 넣는다.
import { EditorView, StateField, StateEffect } from "../../vendor/codemirror.js";
import { placeBlock, figureText } from "./commands.js";

const addPending = StateEffect.define();
const dropPending = StateEffect.define();
const movePending = StateEffect.define(); // { ids, pos }

/** 올리는 중인 그림의 자리표(문서가 바뀌어도 따라감) */
const pendingField = StateField.define({
  create: () => [],
  update(list, tr) {
    let next = tr.docChanged ? list.map((p) => ({ ...p, pos: tr.changes.mapPos(p.pos, 1) })) : list;
    for (const e of tr.effects) {
      if (e.is(addPending)) next = [...next, ...e.value];
      else if (e.is(dropPending)) next = next.filter((p) => p.id !== e.value);
      else if (e.is(movePending)) next = next.map((p) => (e.value.ids.includes(p.id) ? { ...p, pos: e.value.pos } : p));
    }
    return next;
  },
});

const isImage = (f) => /^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(f.type);
let seq = 0;

/**
 * @param {() => ({onImage?: Function})} getOpts 그림 처리 함수를 가져오는 함수
 * @param {{set:(text:string, kind?:string, ms?:number)=>void}} status 상태 표시
 */
export function imageSupport(getOpts, status) {
  let pendingCount = 0, destroyed = false;
  const busy = () => status.set(pendingCount ? `그림 올리는 중… (${pendingCount})` : "", pendingCount ? "busy" : "");

  /** 여러 파일은 한꺼번에 올리되, 원고에는 고른 순서대로 넣는다 */
  async function handleFiles(view, files, pos) {
    const onImage = getOpts().onImage;
    if (!onImage || !files.length) return;
    const items = files.map((file) => ({ id: ++seq, pos, file }));
    view.dispatch({ effects: addPending.of(items.map(({ id, pos }) => ({ id, pos }))) });
    pendingCount += items.length;
    busy();
    const jobs = items.map((it) => Promise.resolve().then(() => onImage(it.file)).then((path) => ({ path }), (error) => ({ error })));
    for (let k = 0; k < items.length; k++) {
      const r = await jobs[k];
      if (destroyed) return;
      pendingCount--;
      if ("error" in r) {
        view.dispatch({ effects: dropPending.of(items[k].id) });
        status.set("그림을 올리지 못했습니다. 원고는 그대로입니다. 다시 시도해 주세요.", "error", 6000);
        continue;
      }
      const end = insertFigure(view, items[k].id, String(r.path));
      view.dispatch({ effects: movePending.of({ ids: items.slice(k + 1).map((x) => x.id), pos: end }) });
      if (pendingCount) busy(); else status.set("");
    }
  }

  /** 자리표 아래에 ::fig 를 넣고, 넣은 글 끝 위치를 돌려줌 */
  function insertFigure(view, id, path) {
    const item = view.state.field(pendingField).find((p) => p.id === id);
    const pos = Math.min(item ? item.pos : view.state.selection.main.head, view.state.doc.length);
    const block = figureText(path);
    const i = block.indexOf("설명");
    const spec = placeBlock(view.state, block, { at: pos, sel: [i, i + 2] });
    const insertLine = view.state.doc.lineAt(pos).number;
    const headLine = view.state.doc.lineAt(view.state.selection.main.head).number;
    // 사용자가 다른 줄로 옮겨 갔으면 커서와 화면 위치를 건드리지 않는다
    if (headLine !== insertLine) { delete spec.selection; spec.scrollIntoView = false; }
    const { from, insert } = spec.changes;
    view.dispatch({ ...spec, effects: dropPending.of(id) });
    return from + insert.length;
  }

  const handlers = EditorView.domEventHandlers({
    paste(e, view) {
      if (!getOpts().onImage) return false;
      const files = [...(e.clipboardData?.files ?? [])].filter(isImage);
      if (!files.length || e.clipboardData.getData("text/plain")) return false;
      e.preventDefault();
      handleFiles(view, files, view.state.selection.main.head);
      return true;
    },
    dragover(e) {
      if (getOpts().onImage && [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) e.preventDefault();
      return false;
    },
    drop(e, view) {
      if (!getOpts().onImage) return false;
      const files = [...(e.dataTransfer?.files ?? [])].filter(isImage);
      if (!files.length) return false;
      e.preventDefault();
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
      handleFiles(view, files, pos);
      return true;
    },
  });

  return {
    extensions: [pendingField, handlers],
    handleFiles,
    destroy() { destroyed = true; },
  };
}
