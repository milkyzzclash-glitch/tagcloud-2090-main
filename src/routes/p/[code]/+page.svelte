<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { PageProps } from './$types';
  import type { CloudWord, ServerMsg } from '$lib/types/cloud';
  import { renderCloud } from '$lib/cloud-render';

  let { data }: PageProps = $props();
  const survey = $derived(data.survey);
  const respondentUrl = $derived(data.respondentUrl);
  const qrPngBase64Data = $derived(data.qrPngBase64Data);
  const creatorToken = $derived(data.creatorToken);
  const isActive = $derived(survey.status === 'active');

  let canvas = $state<HTMLCanvasElement | null>(null);
  // Initial-only чтение через untrack: SSR-снапшот фиксирован, дальше
  // обновляем words только из WS-сообщений.
  let words = $state<Record<string, CloudWord[]>>(
    untrack(() => ({ ...(data.initialWords ?? {}) }))
  );
  let activeIdx = $state(0);

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopReconnect = false;
  // reload guard: см. комментарий в /s/[code]/+page.svelte. На презентации
  // reload менее болезнен (нет form state), но логика та же — закрытый
  // опрос триггерит одну перезагрузку.
  let reloadScheduled = false;

  const activeQuestion = $derived(survey.questions[activeIdx] ?? survey.questions[0]);
  const activeWords = $derived(words[activeQuestion?.id] ?? []);
  const totalVotes = $derived(activeWords.reduce((s, [, c]) => s + c, 0));

  function connect(): void {
    if (typeof window === 'undefined') return;
    if (stopReconnect) return;
    if (!isActive) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/${survey.code}?t=${encodeURIComponent(creatorToken)}`;
    ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.type === 'snapshot') {
          words = { ...words, [msg.questionId]: msg.words };
        } else if (msg.type === 'closed') {
          stopReconnect = true;
          ws?.close();
          if (!reloadScheduled) {
            reloadScheduled = true;
            setTimeout(() => location.reload(), 250);
          }
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (stopReconnect) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 3000);
    };
    ws.onerror = () => {
      ws?.close();
    };
  }

  onMount(() => {
    if (isActive) connect();
  });

  onDestroy(() => {
    stopReconnect = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws && ws.readyState === ws.OPEN) ws.close(1000, 'page unload');
  });

  $effect(() => {
    if (!canvas) return;
    const list = activeWords;
    if (list.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx!.fillStyle = '#FFFFFF';
      ctx!.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const token = { cancelled: false };
    void renderCloud(
      canvas,
      list,
      survey.colorScheme,
      survey.customPalette,
      {
        baseSize: 24,
        maxWords: survey.maxWords,
        allowVertical: survey.allowVertical
      },
      token
    );
    return () => {
      token.cancelled = true;
    };
  });

  let copyDoneCode = $state(false);
  let copyDoneLink = $state(false);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(survey.code);
      copyDoneCode = true;
      setTimeout(() => (copyDoneCode = false), 1500);
    } catch {}
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(respondentUrl);
      copyDoneLink = true;
      setTimeout(() => (copyDoneLink = false), 1500);
    } catch {}
  }

  // Полноэкранный режим: для презентации в классе удобно убрать вкладку
  // и адресную строку. Используем стандартный Fullscreen API; при отказе
  // (Safari/iOS, no permission) просто игнорируем.
  let isFullscreen = $state(false);
  function toggleFullscreen() {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }
  function onFullscreenChange() {
    isFullscreen = typeof document !== 'undefined' && !!document.fullscreenElement;
  }
  onMount(() => {
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  });

  // Стрелочки для переключения между вопросами с клавиатуры — удобно,
  // когда руки на пульте/кликере. Работает только если вопросов > 1.
  function onKeydown(e: KeyboardEvent) {
    if (survey.questions.length <= 1) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      activeIdx = (activeIdx + 1) % survey.questions.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      activeIdx = (activeIdx - 1 + survey.questions.length) % survey.questions.length;
    }
  }
</script>

<svelte:head>
  <title>Презентация · {survey.title ?? survey.code}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<!--
  Режим презентации ломает обычный max-width=880px контейнер: облако
  должно занимать всю доступную ширину. :global на .container
  применяется только пока этот компонент смонтирован — Svelte снимает
  стили вместе с unmount.
-->
<div class="presentation">
  <section class="cloud-area" aria-label="Облако ответов">
    <header class="cloud-head">
      <div class="title-block">
        <h1>{survey.title ?? `Опрос ${survey.code}`}</h1>
        {#if !isActive}
          <span class="badge badge-muted">Завершён</span>
        {/if}
      </div>
      <div class="cloud-actions">
        <a class="btn btn-ghost btn-sm" href={`/s/${survey.code}`}>В дашборд</a>
        <button type="button" class="btn btn-ghost btn-sm" onclick={toggleFullscreen}>
          {isFullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
        </button>
      </div>
    </header>

    {#if survey.questions.length > 1}
      <nav class="tabs" aria-label="Переключение между вопросами">
        {#each survey.questions as q, i (q.id)}
          <button
            type="button"
            class="tab"
            class:active={i === activeIdx}
            onclick={() => (activeIdx = i)}
          >
            {i + 1}. {q.text.length > 40 ? q.text.slice(0, 40) + '…' : q.text}
          </button>
        {/each}
      </nav>
    {/if}

    <div class="active-question">{activeQuestion?.text}</div>

    <div class="canvas-wrap">
      {#if activeWords.length === 0}
        <div class="empty">
          {isActive
            ? 'Пока нет ответов. Покажите QR-код или код опроса.'
            : 'Голосов в этом опросе не было.'}
        </div>
      {/if}
      <canvas bind:this={canvas} width="1600" height="900"></canvas>
    </div>

    <div class="footer-info">
      <span>
        {totalVotes}
        {totalVotes === 1
          ? 'голос'
          : totalVotes >= 2 && totalVotes <= 4 && totalVotes % 100 < 12
            ? 'голоса'
            : 'голосов'}
      </span>
      {#if survey.questions.length > 1}
        <span class="muted">← → переключение вопросов</span>
      {/if}
    </div>
  </section>

  <aside class="share-side" aria-label="Реквизиты опроса">
    <div class="share-block">
      <h2 class="share-h">Код опроса</h2>
      <div class="big-code">{survey.code}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick={copyCode}>
        {copyDoneCode ? 'Скопировано' : 'Копировать код'}
      </button>
    </div>

    <div class="share-block">
      <h2 class="share-h">Ссылка</h2>
      <div class="link-text" title={respondentUrl}>{respondentUrl}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick={copyLink}>
        {copyDoneLink ? 'Скопировано' : 'Копировать ссылку'}
      </button>
    </div>

    <div class="share-block qr-block">
      <h2 class="share-h">QR-код</h2>
      <img class="qr" src={qrPngBase64Data} alt="QR код опроса" />
    </div>
  </aside>
</div>

<style>
  /* Сброс контейнера root-layout: на /p/[code] нужно полное полотно. */
  :global(main.container) {
    max-width: none;
    padding: 0;
    min-height: calc(100vh - 130px);
  }

  .presentation {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: var(--space-6);
    padding: var(--space-6);
    align-items: stretch;
    min-height: calc(100vh - 130px);
  }

  /* ─── Левая колонка: облако ─────────────────────────── */
  .cloud-area {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .cloud-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .title-block {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--c-navy);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cloud-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .tabs {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .tab {
    background: transparent;
    color: var(--c-muted);
    border: 1px solid var(--c-border);
    padding: 6px 12px;
    border-radius: var(--radius);
    font-family: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
    transition:
      background-color 120ms,
      color 120ms;
  }
  .tab:hover:not(.active) {
    background: var(--c-surface);
    color: var(--c-text);
  }
  .tab.active {
    background: var(--c-navy);
    color: white;
    border-color: var(--c-navy);
  }
  .active-question {
    font-weight: 500;
    color: var(--c-text);
    font-size: 1.125rem;
  }
  .canvas-wrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 320px;
    background: #fff;
    border: 1px solid var(--c-border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--c-muted);
    z-index: 1;
    pointer-events: none;
    text-align: center;
    padding: var(--space-4);
    font-size: 1.0625rem;
  }
  .footer-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--c-text);
    font-size: 0.9375rem;
    padding-top: var(--space-1);
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .footer-info .muted {
    color: var(--c-muted);
    font-size: 0.8125rem;
  }

  /* ─── Правая колонка: вертикальный share-блок ────────── */
  .share-side {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    align-self: start;
    box-shadow: var(--shadow-sm);
    position: sticky;
    top: var(--space-4);
  }
  .share-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .share-h {
    font-size: 0.75rem;
    color: var(--c-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    margin: 0;
  }
  .big-code {
    font-size: 2.25rem;
    font-weight: 700;
    color: var(--c-navy);
    letter-spacing: 0.12em;
    font-family: var(--font-mono);
    line-height: 1;
    word-break: break-all;
  }
  .link-text {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: var(--c-text);
    word-break: break-all;
    background: var(--c-bg);
    padding: 8px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--c-border);
  }
  .qr-block {
    align-items: center;
  }
  .qr {
    width: 100%;
    max-width: 280px;
    aspect-ratio: 1 / 1;
    image-rendering: pixelated;
    border: 1px solid var(--c-border);
    border-radius: var(--radius);
    background: #fff;
  }

  /* ─── Адаптив ─────────────────────────────────────────── */
  @media (max-width: 960px) {
    .presentation {
      grid-template-columns: 1fr;
      padding: var(--space-4);
      gap: var(--space-4);
    }
    .share-side {
      position: static;
      order: 2;
    }
    .cloud-area {
      order: 1;
    }
    .canvas-wrap {
      aspect-ratio: 4 / 3;
      min-height: 0;
    }
    .qr {
      max-width: 220px;
    }
  }
</style>
