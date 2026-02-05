import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

/**
 * A very small persistence abstraction:
 * - Uses localStorage by default
 * - Can be swapped to an HTTP backend later without changing UI code
 */
const STORAGE_KEY = "kavia.todos.v1";

/**
 * @typedef {Object} Todo
 * @property {string} id
 * @property {string} title
 * @property {boolean} completed
 * @property {number} createdAt
 * @property {number} updatedAt
 */

function generateId() {
  // Good enough for local-only persistence; can be replaced with backend IDs later.
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeTitle(value) {
  return (value ?? "").toString().trim();
}

function getConfiguredApiBase() {
  // Respect existing env vars; do not hardcode.
  return (
    process.env.REACT_APP_API_BASE ||
    process.env.REACT_APP_BACKEND_URL ||
    ""
  ).trim();
}

async function tryFetchJson(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const message = text || `Request failed with ${res.status}`;
    throw new Error(message);
  }
  // Some backends may return empty responses.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  return res.json();
}

class LocalTodoRepository {
  /** @returns {Promise<Todo[]>} */
  async list() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data;
    } catch {
      return [];
    }
  }

  /** @param {Todo[]} todos */
  async saveAll(todos) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  }
}

/**
 * Backend repository placeholder:
 * We only use it if we can successfully talk to the backend.
 * This avoids breaking the app when env vars are set but no backend exists.
 */
class HttpTodoRepository {
  /**
   * @param {string} apiBase
   */
  constructor(apiBase) {
    this.apiBase = apiBase.replace(/\/$/, "");
  }

  async healthcheck() {
    // Respect env var for health path if present.
    const path = (process.env.REACT_APP_HEALTHCHECK_PATH || "/healthz").trim();
    const url = `${this.apiBase}${path.startsWith("/") ? "" : "/"}${path}`;
    await fetch(url, { method: "GET" });
  }

  /** @returns {Promise<Todo[]>} */
  async list() {
    // This is intentionally conservative. If backend exists later,
    // implement real endpoints and this will start working.
    // For now, throw to force fallback to local storage.
    throw new Error("Backend todo endpoints not implemented in this repo.");
  }

  /** @param {Todo[]} _todos */
  async saveAll(_todos) {
    throw new Error("Backend todo endpoints not implemented in this repo.");
  }
}

/**
 * Choose a repository:
 * - If API base is set and healthcheck succeeds and list() is implemented, use HTTP
 * - Otherwise fallback to local
 */
async function createTodoRepository() {
  const apiBase = getConfiguredApiBase();
  if (!apiBase) return new LocalTodoRepository();

  const httpRepo = new HttpTodoRepository(apiBase);
  try {
    await httpRepo.healthcheck();
    // We still default to local because list/saveAll are not implemented.
    // Returning local avoids breaking production previews.
    return new LocalTodoRepository();
  } catch {
    return new LocalTodoRepository();
  }
}

/**
 * PUBLIC_INTERFACE
 */
function App() {
  const [todos, setTodos] = useState(/** @type {Todo[]} */ ([]));
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
  const [editingTitle, setEditingTitle] = useState("");
  const [error, setError] = useState("");
  const [repo, setRepo] = useState(null);

  const inputRef = useRef(null);

  const stats = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter((t) => t.completed).length;
    const remaining = total - completed;
    return { total, completed, remaining };
  }, [todos]);

  useEffect(() => {
    // Initialize repository, then load todos.
    let cancelled = false;

    (async () => {
      const r = await createTodoRepository();
      if (cancelled) return;
      setRepo(r);

      const loaded = await r.list();
      if (cancelled) return;

      // Stable sort by createdAt ascending.
      loaded.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      setTodos(loaded);
    })().catch((e) => {
      if (!cancelled) setError(e?.message || "Failed to load todos.");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Autofocus new task input for nicer UX.
    inputRef.current?.focus?.();
  }, []);

  async function persist(next) {
    if (!repo) return; // repo not ready yet
    await repo.saveAll(next);
  }

  // PUBLIC_INTERFACE
  const addTodo = async () => {
    setError("");
    const title = normalizeTitle(newTitle);
    if (!title) {
      setError("Please enter a task.");
      return;
    }

    const now = Date.now();
    const next = [
      ...todos,
      {
        id: generateId(),
        title,
        completed: false,
        createdAt: now,
        updatedAt: now,
      },
    ];

    setTodos(next);
    setNewTitle("");
    try {
      await persist(next);
    } catch (e) {
      setError(e?.message || "Failed to save todo.");
    }
  };

  // PUBLIC_INTERFACE
  const deleteTodo = async (id) => {
    setError("");
    const next = todos.filter((t) => t.id !== id);
    setTodos(next);
    try {
      await persist(next);
    } catch (e) {
      setError(e?.message || "Failed to save changes.");
    }
  };

  // PUBLIC_INTERFACE
  const toggleCompleted = async (id) => {
    setError("");
    const now = Date.now();
    const next = todos.map((t) =>
      t.id === id ? { ...t, completed: !t.completed, updatedAt: now } : t
    );
    setTodos(next);
    try {
      await persist(next);
    } catch (e) {
      setError(e?.message || "Failed to save changes.");
    }
  };

  // PUBLIC_INTERFACE
  const startEdit = (todo) => {
    setError("");
    setEditingId(todo.id);
    setEditingTitle(todo.title);
  };

  // PUBLIC_INTERFACE
  const cancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  // PUBLIC_INTERFACE
  const saveEdit = async () => {
    setError("");
    if (!editingId) return;

    const title = normalizeTitle(editingTitle);
    if (!title) {
      setError("Task title cannot be empty.");
      return;
    }

    const now = Date.now();
    const next = todos.map((t) =>
      t.id === editingId ? { ...t, title, updatedAt: now } : t
    );

    setTodos(next);
    setEditingId(null);
    setEditingTitle("");
    try {
      await persist(next);
    } catch (e) {
      setError(e?.message || "Failed to save changes.");
    }
  };

  const onNewKeyDown = (e) => {
    if (e.key === "Enter") addTodo();
  };

  const onEditKeyDown = (e) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <div className="TodoApp">
      <div className="TodoContainer">
        <header className="TodoHeader">
          <div className="TodoHeaderTop">
            <h1 className="TodoTitle">Todo List</h1>
            <span className="TodoPill" aria-label="Todo stats">
              {stats.remaining} remaining • {stats.completed}/{stats.total} done
            </span>
          </div>
          <p className="TodoSubtitle">
            Add tasks, edit them, mark complete, and keep everything saved
            locally.
          </p>
        </header>

        <section className="AddRow" aria-label="Add a new task">
          <label className="SrOnly" htmlFor="new-todo">
            New task
          </label>
          <input
            id="new-todo"
            ref={inputRef}
            className="TodoInput"
            placeholder="What do you need to do?"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={onNewKeyDown}
            maxLength={140}
            inputMode="text"
          />
          <button className="Btn BtnPrimary" onClick={addTodo} type="button">
            Add
          </button>
        </section>

        {error ? (
          <div className="TodoError" role="alert">
            {error}
          </div>
        ) : null}

        <section className="TodoListSection" aria-label="Todo list">
          {todos.length === 0 ? (
            <div className="TodoEmpty">
              <div className="TodoEmptyTitle">No tasks yet</div>
              <div className="TodoEmptyText">
                Add your first task above to get started.
              </div>
            </div>
          ) : (
            <ul className="TodoList">
              {todos.map((todo) => {
                const isEditing = editingId === todo.id;

                return (
                  <li
                    key={todo.id}
                    className={`TodoCard ${todo.completed ? "isDone" : ""}`}
                  >
                    <div className="TodoMain">
                      <button
                        className={`CheckBtn ${
                          todo.completed ? "isChecked" : ""
                        }`}
                        onClick={() => toggleCompleted(todo.id)}
                        type="button"
                        aria-label={
                          todo.completed
                            ? "Mark as not completed"
                            : "Mark as completed"
                        }
                        title={
                          todo.completed
                            ? "Mark as not completed"
                            : "Mark as completed"
                        }
                      >
                        <span className="CheckDot" aria-hidden="true" />
                      </button>

                      <div className="TodoContent">
                        {isEditing ? (
                          <>
                            <label className="SrOnly" htmlFor={`edit-${todo.id}`}>
                              Edit task
                            </label>
                            <input
                              id={`edit-${todo.id}`}
                              className="TodoEditInput"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={onEditKeyDown}
                              autoFocus
                              maxLength={140}
                            />
                            <div className="EditActions">
                              <button
                                className="Btn BtnSuccess"
                                onClick={saveEdit}
                                type="button"
                                title="Save"
                              >
                                Save
                              </button>
                              <button
                                className="Btn BtnGhost"
                                onClick={cancelEdit}
                                type="button"
                                title="Cancel"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="TodoTextRow">
                              <div className="TodoText">{todo.title}</div>
                            </div>

                            <div className="CardActions">
                              <button
                                className="Btn BtnGhost"
                                onClick={() => startEdit(todo)}
                                type="button"
                                title="Edit"
                                aria-label="Edit task"
                              >
                                Edit
                              </button>
                              <button
                                className="Btn BtnDanger"
                                onClick={() => deleteTodo(todo.id)}
                                type="button"
                                title="Delete"
                                aria-label="Delete task"
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="TodoFooter">
          <div className="TodoFooterHint">
            Tips: Press <kbd>Enter</kbd> to add/save. Press <kbd>Esc</kbd> to
            cancel editing.
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
