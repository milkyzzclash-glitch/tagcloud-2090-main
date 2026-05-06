<script lang="ts">
  import '../app.css';
  import { goto, invalidateAll } from '$app/navigation';
  let { children, data } = $props();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    await invalidateAll();
    await goto('/');
  }
</script>

<header class="topbar">
  <a class="brand" href={data.user ? '/my' : '/'}>
    <img class="brand-logo" src="/logo2090.png" alt="Школа №2090" />
    <span class="brand-text">Облако тегов</span>
  </a>

  <nav class="nav">
    {#if data.user}
      <button type="button" class="btn btn-ghost btn-sm" onclick={logout}>Выход</button>
    {:else}
      <a class="nav-link" href="/login">Войти</a>
    {/if}
  </nav>
</header>

<main class="container">
  {@render children()}
</main>

<footer class="footer">
  <span>Школа №2090 · образовательный проект</span>
</footer>

<style>
  .topbar {
    border-bottom: 1px solid var(--c-border);
    padding: var(--space-3) var(--space-6);
    background: var(--c-bg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    position: relative;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--c-navy);
    font-weight: 600;
    text-decoration: none;
    min-width: 0;
  }
  .brand:hover {
    text-decoration: none;
  }
  .brand-logo {
    height: 56px;
    width: 56px;
    object-fit: contain;
    display: block;
    flex-shrink: 0;
  }
  .brand-text {
    color: var(--c-text);
    font-weight: 500;
    font-size: 1.0625rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }
  .nav-link {
    color: var(--c-navy);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    padding: 6px 4px;
  }
  .nav-link:hover {
    text-decoration: underline;
  }

  .container {
    max-width: 880px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
    min-height: calc(100vh - 130px);
  }
  .footer {
    border-top: 1px solid var(--c-border);
    padding: var(--space-4) var(--space-6);
    color: var(--c-muted);
    font-size: 0.875rem;
    text-align: center;
  }

  @media (max-width: 640px) {
    .topbar {
      padding: var(--space-3) var(--space-4);
    }
    .brand-logo {
      height: 44px;
      width: 44px;
    }
    .brand-text {
      font-size: 0.95rem;
    }
    .container {
      padding: var(--space-6) var(--space-4);
      min-height: calc(100vh - 160px);
    }
  }
</style>
