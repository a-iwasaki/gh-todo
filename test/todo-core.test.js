const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../todo-core.js');

const todo = (id, done = false, title = `タスク${id}`) => ({ id, title, done });

// localStorage の代わり
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test('追加した項目は先頭に入り、元の配列は変わらない', () => {
  const before = [todo('a')];
  const after = Core.addTodo(before, '  牛乳を買う  ', 'b');
  assert.deepEqual(after, [todo('b', false, '牛乳を買う'), todo('a')]);
  assert.deepEqual(before, [todo('a')]);
});

test('空白だけのタイトルは追加しない', () => {
  const todos = [];
  for (const title of ['', '   ', '　　', '\n\t', undefined, null]) {
    assert.equal(Core.addTodo(todos, title), todos);
  }
});

test('タイトル内の全角スペースは残す', () => {
  const [item] = Core.addTodo([], '　牛乳　2本　');
  assert.equal(item.title, '牛乳　2本');
});

test('長いタイトルは絵文字を壊さずに切り詰める', () => {
  const [item] = Core.addTodo([], '🍎'.repeat(Core.MAX_TITLE_LENGTH + 5));
  assert.equal(item.title, '🍎'.repeat(Core.MAX_TITLE_LENGTH));
});

test('追加するたびに異なる ID が付く', () => {
  let todos = [];
  for (let i = 0; i < 100; i += 1) todos = Core.addTodo(todos, 'x');
  assert.equal(new Set(todos.map((item) => item.id)).size, 100);
});

test('完了状態を切り替える。変化がなければ同じ配列を返す', () => {
  const todos = [todo('a'), todo('b')];
  assert.deepEqual(Core.setDone(todos, 'b', true), [todo('a'), todo('b', true)]);
  assert.equal(Core.setDone(todos, 'a', false), todos);
  assert.equal(Core.setDone(todos, 'missing', true), todos);
});

test('名前を変更する。空欄なら元のまま', () => {
  const todos = [todo('a')];
  assert.equal(Core.renameTodo(todos, 'a', ' 新しい名前 ')[0].title, '新しい名前');
  assert.equal(Core.renameTodo(todos, 'a', '   '), todos);
  assert.equal(Core.renameTodo(todos, 'a', 'タスクa'), todos);
});

test('削除した項目は元の位置に戻せる', () => {
  const todos = [todo('a'), todo('b'), todo('c')];
  const { todos: next, removed } = Core.removeTodo(todos, 'b');
  assert.deepEqual(next, [todo('a'), todo('c')]);
  assert.deepEqual(Core.restoreTodos(next, removed), todos);
});

test('完了済みをまとめて削除し、元の並びに戻せる', () => {
  const todos = [todo('a', true), todo('b'), todo('c', true), todo('d'), todo('e', true)];
  const { todos: next, removed } = Core.clearCompleted(todos);
  assert.deepEqual(next, [todo('b'), todo('d')]);
  assert.equal(removed.length, 3);
  assert.deepEqual(Core.restoreTodos(next, removed), todos);
});

test('すでに存在する項目は二重に復元しない', () => {
  const todos = [todo('a')];
  assert.equal(Core.restoreTodos(todos, [{ todo: todo('a'), index: 0 }]), todos);
});

test('絞り込みと残り件数', () => {
  const todos = [todo('a'), todo('b', true), todo('c')];
  assert.deepEqual(Core.filterTodos(todos, 'all'), todos);
  assert.deepEqual(Core.filterTodos(todos, 'active'), [todo('a'), todo('c')]);
  assert.deepEqual(Core.filterTodos(todos, 'completed'), [todo('b', true)]);
  assert.equal(Core.countActive(todos), 2);
});

test('保存した内容を読み込める', () => {
  const storage = fakeStorage();
  const todos = [todo('a'), todo('b', true)];
  assert.equal(Core.saveTodos(storage, todos), true);
  assert.deepEqual(Core.loadTodos(storage), { todos, status: 'ok' });
});

test('保存データがなければ空の一覧', () => {
  assert.deepEqual(Core.loadTodos(fakeStorage()), { todos: [], status: 'ok' });
});

test('壊れたデータは退避してから空の一覧にする', () => {
  for (const raw of ['{壊れている', 'null', '[]', '{"version":2,"todos":[]}']) {
    const storage = fakeStorage({ [Core.STORAGE_KEY]: raw });
    assert.deepEqual(Core.loadTodos(storage), { todos: [], status: 'recovered' }, raw);
    assert.equal(storage.data.get(Core.BACKUP_KEY), raw);
  }
});

test('不正な項目だけを除き、元のデータは退避する', () => {
  const raw = JSON.stringify({
    version: 1,
    todos: [todo('a'), null, { id: 'x', title: '', done: false }, todo('a'), { id: 'y', title: 'y' }, todo('b')],
  });
  const storage = fakeStorage({ [Core.STORAGE_KEY]: raw });
  assert.deepEqual(Core.loadTodos(storage), { todos: [todo('a'), todo('b')], status: 'recovered' });
  assert.equal(storage.data.get(Core.BACKUP_KEY), raw);
});

test('ストレージが使えなくても例外にしない', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };
  for (const storage of [null, broken]) {
    assert.deepEqual(Core.loadTodos(storage), { todos: [], status: 'unavailable' });
    assert.equal(Core.saveTodos(storage, [todo('a')]), false);
  }
});

test('退避に失敗した場合はそれを知らせる', () => {
  const storage = {
    getItem: () => '{壊れている',
    setItem: () => {
      throw new Error('quota');
    },
  };
  assert.deepEqual(Core.loadTodos(storage), { todos: [], status: 'backup-failed' });
});
