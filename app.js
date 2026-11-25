// 画面の描画とイベント処理
(function () {
  'use strict';

  const Core = globalThis.TodoCore;

  const form = document.getElementById('add-form');
  const newInput = document.getElementById('new-todo');
  const list = document.getElementById('list');
  const template = document.getElementById('item-template');
  const emptyMessage = document.getElementById('empty');
  const count = document.getElementById('count');
  const filterButtons = [...document.querySelectorAll('[data-filter]')];
  const clearButton = document.getElementById('clear-completed');
  const notice = document.getElementById('notice');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  const undoButton = document.getElementById('undo');

  const UNDO_TIMEOUT_MS = 8000;
  const SAVE_FAILED = '保存できませんでした。ブラウザの保存容量や設定を確認してください。';
  const LOAD_NOTICES = {
    ok: '',
    unavailable: 'このブラウザではデータを保存できません。ページを閉じると内容は失われます。',
    recovered: `保存データの一部を読み込めませんでした。元のデータは localStorage の「${Core.BACKUP_KEY}」に退避しています。`,
    'backup-failed': '保存データの一部を読み込めず、退避もできませんでした。操作すると元のデータは上書きされます。',
  };
  const EMPTY_MESSAGES = {
    all: 'タスクはありません。上の欄から追加してください。',
    active: '未完了のタスクはありません。',
    completed: '完了済みのタスクはありません。',
  };

  // Cookie をブロックしていると、localStorage を参照するだけで例外になる
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    // 保存できない状態として扱う
  }

  let todos = [];
  let filter = 'all';
  let editingId = null;
  let lastRemoved = [];
  let toastTimer = 0;

  // ---- 状態の読み込みと保存 ----

  function load() {
    const result = Core.loadTodos(storage);
    todos = result.todos;
    showNotice(LOAD_NOTICES[result.status]);
  }

  function setTodos(next) {
    if (next !== todos) {
      todos = next;
      if (!Core.saveTodos(storage, todos)) showNotice(SAVE_FAILED);
      else if (notice.textContent === SAVE_FAILED) showNotice('');
    }
    render();
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = !message;
  }

  // ---- 描画 ----

  // 既存の要素は作り直さずに更新する。作り直すと、
  // 編集を確定した直後のクリックやキーボードのフォーカスが失われる。
  function render() {
    const focused = captureFocus();
    const visible = Core.filterTodos(todos, filter);
    const visibleIds = new Set(visible.map((todo) => todo.id));
    const items = new Map([...list.children].map((li) => [li.dataset.id, li]));

    // 要素を消すと focusout が起きることがあるので、先に編集状態を解除する
    if (!visibleIds.has(editingId)) editingId = null;

    for (const [id, li] of items) {
      if (!visibleIds.has(id)) li.remove();
    }
    visible.forEach((todo, index) => {
      const li = items.get(todo.id) ?? createItem(todo.id);
      updateItem(li, todo);
      if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
    });

    emptyMessage.textContent = EMPTY_MESSAGES[filter];
    emptyMessage.hidden = visible.length > 0;
    count.textContent = `残り ${Core.countActive(todos)} 件`;
    clearButton.disabled = !todos.some((todo) => todo.done);
    for (const button of filterButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    }

    restoreFocus(focused);
  }

  function createItem(id) {
    const li = template.content.firstElementChild.cloneNode(true);
    li.dataset.id = id;
    return li;
  }

  function updateItem(li, todo) {
    const editing = todo.id === editingId;
    const part = (action) => li.querySelector(`[data-action="${action}"]`);
    const title = li.querySelector('.item__title');

    li.classList.toggle('item--done', todo.done);
    if (!editing) li.style.minHeight = '';

    part('toggle').checked = todo.done;
    part('toggle').setAttribute('aria-label', todo.title);
    title.textContent = todo.title;
    title.hidden = editing;
    part('rename').hidden = !editing;
    part('edit').hidden = editing;
    part('delete').hidden = editing;
    part('edit').setAttribute('aria-label', `「${todo.title}」を編集`);
    part('delete').setAttribute('aria-label', `「${todo.title}」を削除`);
  }

  function captureFocus() {
    const element = document.activeElement;
    if (!element || !list.contains(element)) return null;
    const li = element.closest('li');
    return { li, index: [...list.children].indexOf(li), action: element.dataset.action };
  }

  // フォーカスしていた項目が消えた場合は、隣の項目の同じ操作へ移す
  function restoreFocus(focused) {
    if (!focused || focused.li.isConnected) return;
    const neighbor = list.children[Math.min(focused.index, list.children.length - 1)];
    (neighbor?.querySelector(`[data-action="${focused.action}"]`) ?? newInput).focus();
  }

  function findItem(id) {
    return [...list.children].find((li) => li.dataset.id === id);
  }

  // ---- 編集 ----

  function startEdit(id) {
    const todo = todos.find((item) => item.id === id);
    const li = findItem(id);
    if (!todo || !li) return;

    // 複数行のタイトルでも、行の高さが変わって下の項目が動かないようにする
    li.style.minHeight = `${li.offsetHeight}px`;
    editingId = id;
    render();

    const input = li.querySelector('[data-action="rename"]');
    input.value = todo.title;
    input.focus();
    input.select();
  }

  function finishEdit({ save, refocus }) {
    if (editingId === null) return;
    const id = editingId;
    const li = findItem(id);
    const { value } = li.querySelector('[data-action="rename"]');

    editingId = null;
    setTodos(save ? Core.renameTodo(todos, id, value) : todos);
    if (refocus) li.querySelector('[data-action="edit"]').focus();
  }

  // ---- 削除と「元に戻す」 ----

  function applyRemoval({ todos: next, removed }) {
    if (!removed.length) return;
    lastRemoved = removed;
    setTodos(next);
    toastText.textContent =
      removed.length === 1 ? `「${removed[0].todo.title}」を削除しました` : `${removed.length} 件を削除しました`;
    toast.hidden = false;
    scheduleToastHide();
  }

  function scheduleToastHide() {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      // 操作しようとしている間は消さない
      if (toast.matches(':hover, :focus-within')) scheduleToastHide();
      else toast.hidden = true;
    }, UNDO_TIMEOUT_MS);
  }

  // 操作したボタンが無効化・非表示になるときのフォーカスの移動先
  function focusCurrentFilter() {
    filterButtons.find((button) => button.dataset.filter === filter).focus();
  }

  // ---- イベント ----

  // 日本語入力の変換中かどうか（Safari は keyCode でしか判定できない場合がある）
  function isComposing(event) {
    return event.isComposing || event.keyCode === 229;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = Core.addTodo(todos, newInput.value);
    if (next === todos) return;
    newInput.value = '';
    // 追加した項目が見えるようにする
    if (filter === 'completed') filter = 'all';
    setTodos(next);
  });

  // 変換確定の Enter でフォームが送信されないようにする
  newInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && isComposing(event)) event.preventDefault();
  });

  list.addEventListener('change', (event) => {
    if (event.target.dataset.action !== 'toggle') return;
    const { id } = event.target.closest('li').dataset;
    setTodos(Core.setDone(todos, id, event.target.checked));
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { id } = button.closest('li').dataset;
    if (button.dataset.action === 'edit') startEdit(id);
    if (button.dataset.action === 'delete') applyRemoval(Core.removeTodo(todos, id));
  });

  list.addEventListener('dblclick', (event) => {
    if (event.target.classList.contains('item__title')) startEdit(event.target.closest('li').dataset.id);
  });

  list.addEventListener('keydown', (event) => {
    if (event.target.dataset.action !== 'rename' || isComposing(event)) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    finishEdit({ save: event.key === 'Enter', refocus: true });
  });

  list.addEventListener('focusout', (event) => {
    if (event.target.dataset.action !== 'rename') return;
    // 別のウィンドウに切り替えただけなら、編集を続ける
    if (document.activeElement === event.target) return;
    finishEdit({ save: true, refocus: false });
  });

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      render();
    });
  }

  clearButton.addEventListener('click', () => {
    applyRemoval(Core.clearCompleted(todos));
    focusCurrentFilter();
  });

  undoButton.addEventListener('click', () => {
    setTodos(Core.restoreTodos(todos, lastRemoved));
    lastRemoved = [];
    toast.hidden = true;
    focusCurrentFilter();
  });

  // 別のタブでの変更を反映する（反映しないと、古い内容で上書きしてしまう）
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== Core.STORAGE_KEY) return;
    load();
    render();
  });

  load();
  render();
})();
