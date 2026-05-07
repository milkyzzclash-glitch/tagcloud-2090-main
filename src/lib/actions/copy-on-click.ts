/**
 * Svelte action: при hover показывает рядом с курсором подсказку
 * «Скопировать», по клику кладёт значение в clipboard и меняет
 * подсказку на «Скопировано». Когда курсор уходит — подсказка
 * пропадает и при следующем заходе снова показывает «Скопировать».
 *
 * Используется в /p/[code] и /s/[code] для кода опроса, ссылки и QR.
 *
 * Параметры:
 *   { kind: 'text', text }            — копируем строку.
 *   { kind: 'image', image, fallbackText } — пытаемся положить PNG в
 *     clipboard через ClipboardItem; если браузер не поддерживает
 *     image-clipboard — fallback на копирование fallbackText (URL).
 *
 * Реализация: один общий tooltip-DOM на action; элемент создаётся
 * лениво при первом mouseenter и сидит на body. Нет глобальных стилей.
 */
import type { Action } from 'svelte/action';

export type CopyParams =
  | { kind: 'text'; text: string }
  | { kind: 'image'; image: string; fallbackText: string };

const HINT = 'Скопировать';
const DONE = 'Скопировано';

export const copyOnClick: Action<HTMLElement, CopyParams> = (node, initial) => {
  let params: CopyParams = initial;
  let mode: 'hint' | 'done' = 'hint';
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  let tip: HTMLDivElement | null = null;

  function ensureTip(): HTMLDivElement {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'background:#0E2A5C',
      'color:#fff',
      'font:500 12px/1 sans-serif',
      'padding:6px 10px',
      'border-radius:6px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.18)',
      'z-index:9999',
      'transform:translate3d(0,0,0)',
      'transition:opacity 80ms',
      'opacity:0',
      'white-space:nowrap'
    ].join(';');
    tip.textContent = HINT;
    document.body.appendChild(tip);
    return tip;
  }

  function setText() {
    if (tip) tip.textContent = mode === 'hint' ? HINT : DONE;
  }

  function show() {
    ensureTip().style.opacity = '1';
  }

  function hide() {
    if (!tip) return;
    tip.style.opacity = '0';
    // не удаляем сразу — следующий ховер может прийти быстро.
    // Сбрасываем mode, чтобы при возврате снова была подсказка
    // «Скопировать».
    mode = 'hint';
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    setText();
  }

  function move(e: MouseEvent) {
    const t = ensureTip();
    // 14px — небольшой отступ от курсора, чтобы tip не заслонял
    // элемент и не дёргался под самим курсором.
    t.style.left = `${e.clientX + 14}px`;
    t.style.top = `${e.clientY + 14}px`;
  }

  async function copy() {
    try {
      if (params.kind === 'text') {
        await navigator.clipboard.writeText(params.text);
      } else {
        // ClipboardItem поддерживается в Chromium/Safari/Firefox 127+,
        // но фоллбек на текст всё равно держим — если PNG не
        // помещается или contetnt-type не поддержан, юзер получит
        // хотя бы ссылку.
        const ok = await copyImage(params.image);
        if (!ok) await navigator.clipboard.writeText(params.fallbackText);
      }
      mode = 'done';
      setText();
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        mode = 'hint';
        setText();
        resetTimer = null;
      }, 1500);
    } catch {
      /* ignore — clipboard API может быть запрещён */
    }
  }

  node.style.cursor = 'pointer';
  node.addEventListener('mouseenter', show);
  node.addEventListener('mousemove', move);
  node.addEventListener('mouseleave', hide);
  node.addEventListener('click', copy);

  return {
    update(next) {
      params = next;
    },
    destroy() {
      node.removeEventListener('mouseenter', show);
      node.removeEventListener('mousemove', move);
      node.removeEventListener('mouseleave', hide);
      node.removeEventListener('click', copy);
      if (resetTimer) clearTimeout(resetTimer);
      if (tip) {
        tip.remove();
        tip = null;
      }
    }
  };
};

async function copyImage(dataUrlOrUrl: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined') return false;
    const res = await fetch(dataUrlOrUrl);
    const blob = await res.blob();
    // Большинство браузеров требуют image/png для clipboard.
    if (blob.type !== 'image/png') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
