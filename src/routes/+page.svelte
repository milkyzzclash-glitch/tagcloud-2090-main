<script lang="ts">
  // Главная только для гостей: залогиненных редиректит на /my (см. +page.server.ts).
</script>

<svelte:head>
  <title>Облако тегов — Школа №2090</title>
</svelte:head>

<section class="hero">
  <h1>Облако тегов</h1>
  <p class="lead">Анонимные опросы для школьных мероприятий.</p>

  <div class="cta-row">
    <a class="btn btn-primary btn-lg" href="/join">Пройти опрос</a>
    <a class="btn btn-ghost btn-lg" href="/login">Войти</a>
  </div>
</section>

<style>
  .hero {
    padding: var(--space-12) 0;
  }
  h1 {
    font-size: 2.25rem;
    margin-bottom: var(--space-3);
  }
  .lead {
    color: var(--c-muted);
    font-size: 1.0625rem;
    max-width: 56ch;
    line-height: 1.6;
    margin: 0 0 var(--space-6);
  }
  .cta-row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  @media (max-width: 480px) {
    h1 {
      font-size: 1.75rem;
    }
    .lead {
      font-size: 1rem;
    }
    .cta-row .btn {
      width: 100%;
    }
  }
</style>
