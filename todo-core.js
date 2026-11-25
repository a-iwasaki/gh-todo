// TODO の状態操作と保存処理。DOM に依存しないので Node.js でもテストできる。
(function () {
  'use strict';

  const STORAGE_KEY = 'gh-todo:v1';
  const BACKUP_KEY = 'gh-todo:v1:backup';
  const MAX_TITLE_LENGTH = 200;

  function normalizeTitle(value) {
    const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    // 絵文字などを途中で切らないように、コードポイント単位で数える
    return Array.from(text).slice(0, MAX_TITLE_LENGTH).join('').trim();
  }

  function createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // 以下の操作はどれも元の配列を変更しない。何も変わらない場合は同じ配列を返す。

  function addTodo(todos, title, id = createId()) {
    const normalized = normalizeTitle(title);
    if (!normalized) return todos;
    return [{ id, title: normalized, done: false }, ...todos];
  }

  function updateTodo(todos, id, changes) {
    const target = todos.find((todo) => todo.id === id);
    if (!target) return todos;
    if (Object.keys(changes).every((key) => target[key] === changes[key])) return todos;
    return todos.map((todo) => (todo === target ? { ...todo, ...changes } : todo));
  }

  function setDone(todos, id, done) {
    return updateTodo(todos, id, { done: Boolean(done) });
  }

  function renameTodo(todos, id, title) {
    const normalized = normalizeTitle(title);
    // 空欄で確定した場合は、元のタイトルを残す
    if (!normalized) return todos;
    return updateTodo(todos, id, { title: normalized });
  }

  // 削除系は「元に戻す」ために、削除した項目と元の位置も返す
  function removeWhere(todos, predicate) {
    const removed = [];
    const kept = todos.filter((todo, index) => {
      if (!predicate(todo)) return true;
      removed.push({ todo, index });
      return false;
    });
    return { todos: removed.length ? kept : todos, removed };
  }

  function removeTodo(todos, id) {
    return removeWhere(todos, (todo) => todo.id === id);
  }

  function clearCompleted(todos) {
    return removeWhere(todos, (todo) => todo.done);
  }

  function restoreTodos(todos, removed) {
    const next = [...todos];
    // removed は元の位置の昇順なので、前から順に差し込めば元の並びに戻る
    for (const { todo, index } of removed) {
      if (next.some((item) => item.id === todo.id)) continue;
      next.splice(Math.min(index, next.length), 0, todo);
    }
    return next.length === todos.length ? todos : next;
  }

  function filterTodos(todos, filter) {
    if (filter === 'active') return todos.filter((todo) => !todo.done);
    if (filter === 'completed') return todos.filter((todo) => todo.done);
    return todos;
  }

  function countActive(todos) {
    return filterTodos(todos, 'active').length;
  }

  function serialize(todos) {
    return JSON.stringify({ version: 1, todos });
  }

  // damaged は、読み込めずに捨てたデータがあることを表す
  function parse(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { todos: [], damaged: true };
    }
    if (data?.version !== 1 || !Array.isArray(data.todos)) {
      return { todos: [], damaged: true };
    }

    const ids = new Set();
    const todos = [];
    for (const item of data.todos) {
      if (typeof item?.id !== 'string' || !item.id || ids.has(item.id)) continue;
      if (typeof item.title !== 'string' || typeof item.done !== 'boolean') continue;
      const title = normalizeTitle(item.title);
      if (!title) continue;
      ids.add(item.id);
      todos.push({ id: item.id, title, done: item.done });
    }
    return { todos, damaged: todos.length !== data.todos.length };
  }

  // status: 'ok' | 'unavailable' | 'recovered' | 'backup-failed'
  function loadTodos(storage) {
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      return { todos: [], status: 'unavailable' };
    }
    if (raw === null) return { todos: [], status: 'ok' };

    const { todos, damaged } = parse(raw);
    if (!damaged) return { todos, status: 'ok' };

    // 次の保存で上書きされる前に、元のデータを退避する
    try {
      storage.setItem(BACKUP_KEY, raw);
    } catch {
      return { todos, status: 'backup-failed' };
    }
    return { todos, status: 'recovered' };
  }

  function saveTodos(storage, todos) {
    try {
      storage.setItem(STORAGE_KEY, serialize(todos));
      return true;
    } catch {
      return false;
    }
  }

  const TodoCore = {
    STORAGE_KEY,
    BACKUP_KEY,
    MAX_TITLE_LENGTH,
    addTodo,
    setDone,
    renameTodo,
    removeTodo,
    clearCompleted,
    restoreTodos,
    filterTodos,
    countActive,
    loadTodos,
    saveTodos,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TodoCore;
  } else {
    globalThis.TodoCore = TodoCore;
  }
})();
