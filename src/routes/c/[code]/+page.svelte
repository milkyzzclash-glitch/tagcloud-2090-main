<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { PageProps } from './$types';
  import type { CloudWord } from '$lib/types/cloud';
  import { renderCloud } from '$lib/cloud-render';
  import type { ServerMsg } from '$lib/types/cloud';

  let { data }: PageProps = $props();
  const survey = $derived(data.survey);

  let canvas = $state<HTMLCanvasElement | null>(null);
  // Initial-only чтение через untrack: SSR-снапшот фиксирован, дальше
  // обновляем words только из WS-сообщений.
  let words = $state<Record<string, CloudWord[]>>(untrack(() => ({ ...data.initialWords })));
  let activeIdx = $state(0);
  // Стартовое значение фиксируем через untrack: SSR-снапшот survey.status —
  // это начальное состояние, а дальше «закрытость» идёт из WS-сообщения
  // 'closed'. Без untrack Svelte 5 предупреждает о захвате реактивного $derived.
  let stopped = $state(untrack(() => survey.status !== 'active'));

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopReconnect = false;

  const activeQuestion = $derived(survey.questions[activeIdx] ?? survey.questions[0]);
  const activeWords = $derived(words[activeQuestion?.id] ?? []);
  const totalVotes = $derived(activeWords.reduce((s, [, c]) => s + c, 0));

  /**
   * Подключение к публичному read-only WS `/ws/c/<code>`. В отличие от
   * креаторского `/ws/<code>` не требует токена (опрос с известным
   * кодом — публичен по дизайну: любой респондент уже знает код).
   * Сервер бродкастит cloud:<questionId> snapshots каждые 2.5с при
   * наличии изменений, что покрывает любой кейс «облако обновляется».
   * Поллинга больше нет — нагрузка на Postgres от просмотра страницы
   * /c/[code] стремится к нулю (только при поступлении нового голоса
   * Redis-агрегат пересчитывается, и WS уже подписан на pub/sub).
   */
  function connect(): void {
    if (typeof window === 'undefined') return;
    if (stopReconnect || stopped) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${window.location.host}/ws/c/${survey.code}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.type === 'snapshot') {
          words = { ...words, [msg.questionId]: msg.words };
        } else if (msg.type === 'closed') {
          stopReconnect = true;
          stopped = true;
          ws?.close();
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (stopReconnect) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      // Экспоненциальная пауза не нужна — обычные WS-разрывы редки и
      // 3 секунды дают серверу спокойно перезапуститься.
      reconnectTimer = setTimeout(connect, 3000);
    };
  }

  onMount(() => {
    if (!stopped) connect();
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
        baseSize: 20,
        maxWords: survey.maxWords,
        allowVertical: survey.allowVertical
      },
      token
    );
    return () => {
      token.cancelled = true;
    };
  });
</script>

<svelte:head>
  <title>Облако · {survey.title ?? survey.code}</title>
</svelte:head>

<section class="head">
  <h1>{survey.title ?? `Опрос ${survey.code}`}</h1>
  <p class="muted">
    {#if survey.status === 'active' && !stopped}
      Облако обновляется автоматически. Голосов в этом вопросе: {totalVotes}.
    {:else}
      Опрос завершён. Голосов в этом вопросе: {totalVotes}.
    {/if}
  </p>
</section>

{#if survey.questions.length > 1}
  <div class="tabs">
    {#each survey.questions as q, i (q.id)}
      <button
        type="button"
        class="tab"
        class:active={i === activeIdx}
        onclick={() => (activeIdx = i)}
      >
        {i + 1}. {q.text.length > 30 ? q.text.slice(0, 30) + '…' : q.text}
      </button>
    {/each}
  </div>
{/if}

<div class="active-question">{activeQuestion?.text}</div>

<div class="canvas-wrap">
  {#if activeWords.length === 0}
    <div class="empty">Пока нет ответов.</div>
  {/if}
  <canvas bind:this={canvas} width="1200" height="700"></canvas>
</div>

<style>
  .head {
    margin-bottom: var(--space-4);
  }
  .muted {
    color: var(--c-muted);
  }
  .tabs {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin: var(--space-3) 0;
  }
  .tab {
    border: 1px solid var(--c-border);
    background: var(--c-bg);
    color: var(--c-text);
    border-radius: var(--radius-md);
    padding: 6px 10px;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .tab.active {
    background: var(--c-navy);
    color: white;
    border-color: var(--c-navy);
  }
  .active-question {
    font-weight: 500;
    margin: var(--space-2) 0 var(--space-3);
  }
  .canvas-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 12 / 7;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: white;
  }
  .canvas-wrap canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--c-muted);
  }
</style>
