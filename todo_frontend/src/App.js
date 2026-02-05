import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FiBell,
  FiCheck,
  FiCircle,
  FiEdit2,
  FiFilter,
  FiPlus,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import "./App.css";

/**
 * A very small persistence abstraction:
 * - Uses localStorage by default
 * - Can be swapped to an HTTP backend later without changing UI code
 */
const STORAGE_KEY = "kavia.todos.v1";

/**
 * @typedef {"low"|"medium"|"high"} Priority
 */

/**
 * @typedef {"all"|"today"|"upcoming"|"overdue"} DueStatusFilter
 */

/**
 * @typedef {Object} Todo
 * @property {string} id
 * @property {string} title
 * @property {boolean} completed
 * @property {Priority} priority
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string|null} [dueDate] ISO string representing a due date-time (or null if not set)
 * @property {string|null} [reminderAt] ISO string representing reminder date-time (or null if not set)
 * @property {boolean} [reminderTriggered] Whether reminder toast has already been shown
 */

const PRIORITY_LABELS = /** @type {Record<Priority, string>} */ ({
  low: "Low",
  medium: "Medium",
  high: "High",
});

const PRIORITY_OPTIONS = /** @type {Array<{value: Priority, label: string}>} */ (
  [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ]
);

function generateId() {
  // Good enough for local-only persistence; can be replaced with backend IDs later.
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeTitle(value) {
  return (value ?? "").toString().trim();
}

function safeParseDateMs(isoString) {
  if (!isoString) return null;
  const ms = Date.parse(String(isoString));
  return Number.isFinite(ms) ? ms : null;
}

function startOfLocalDayMs(dateMs) {
  const d = new Date(dateMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isSameLocalDay(aMs, bMs) {
  return startOfLocalDayMs(aMs) === startOfLocalDayMs(bMs);
}

function formatLocalDueDate(isoString) {
  const ms = safeParseDateMs(isoString);
  if (ms == null) return "";
  // Keep it readable and consistent; local date only.
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Ensure todos loaded from persistence are migration-safe.
 * - Existing tasks without "priority" are treated as "medium".
 * - Adds new fields: dueDate, reminderAt, reminderTriggered (all optional).
 * - Keeps unknown values safe by coercing to "medium".
 * @param {any[]} items
 * @returns {Todo[]}
 */
function normalizeTodos(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((t) => t && typeof t === "object")
    .map((t) => {
      /** @type {Priority} */
      const priority =
        t.priority === "low" || t.priority === "medium" || t.priority === "high"
          ? t.priority
          : "medium";

      const dueDate =
        typeof t.dueDate === "string" && safeParseDateMs(t.dueDate) != null
          ? t.dueDate
          : null;

      const reminderAt =
        typeof t.reminderAt === "string" && safeParseDateMs(t.reminderAt) != null
          ? t.reminderAt
          : null;

      const reminderTriggered = Boolean(t.reminderTriggered);

      return {
        id: String(t.id ?? generateId()),
        title: String(t.title ?? ""),
        completed: Boolean(t.completed),
        priority,
        createdAt: Number(t.createdAt ?? Date.now()),
        updatedAt: Number(t.updatedAt ?? Date.now()),
        dueDate,
        reminderAt,
        reminderTriggered,
      };
    });
}

function getConfiguredApiBase() {
  // Respect existing env vars; do not hardcode.
  return (
    process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || ""
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
      return normalizeTodos(data);
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
 * Build an ISO string from local date + time inputs.
 * If time is omitted, uses 09:00 local time (reasonable default for reminders).
 */
function buildLocalIsoFromDateAndTime(dateStr, timeStr, fallbackTime = "09:00") {
  if (!dateStr) return null;
  const t = timeStr || fallbackTime;
  const ms = Date.parse(`${dateStr}T${t}`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Returns due badge info for a todo.
 * @param {Todo} todo
 */
function getDueBadge(todo) {
  const dueMs = safeParseDateMs(todo.dueDate);
  if (dueMs == null) return null;

  const nowMs = Date.now();
  const dueDay = startOfLocalDayMs(dueMs);
  const todayDay = startOfLocalDayMs(nowMs);

  if (dueDay < todayDay && !todo.completed) {
    return { text: "Overdue", tone: "overdue" };
  }
  if (dueDay === todayDay) {
    return { text: "Due today", tone: "today" };
  }
  return { text: formatLocalDueDate(todo.dueDate), tone: "upcoming" };
}

/**
 * @param {Todo} todo
 * @returns {"none"|"today"|"upcoming"|"overdue"}
 */
function getDueStatus(todo) {
  const dueMs = safeParseDateMs(todo.dueDate);
  if (dueMs == null) return "none";

  const nowMs = Date.now();
  const dueDay = startOfLocalDayMs(dueMs);
  const todayDay = startOfLocalDayMs(nowMs);

  if (dueDay < todayDay && !todo.completed) return "overdue";
  if (dueDay === todayDay) return "today";
  if (dueDay > todayDay) return "upcoming";
  return "none";
}

/**
 * PUBLIC_INTERFACE
 */
function App() {
  const [todos, setTodos] = useState(/** @type {Todo[]} */ ([]));
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState(/** @type {Priority} */ ("medium"));
  const [newDueDate, setNewDueDate] = useState(""); // YYYY-MM-DD for <input type="date" />
  const [newReminderTime, setNewReminderTime] = useState(""); // HH:mm for <input type="time" />

  const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
  const [editingTitle, setEditingTitle] = useState("");
  const [editingPriority, setEditingPriority] = useState(
    /** @type {Priority} */ ("medium")
  );
  const [editingDueDate, setEditingDueDate] = useState("");
  const [editingReminderTime, setEditingReminderTime] = useState("");

  const [priorityFilter, setPriorityFilter] = useState(
    /** @type {"all" | Priority} */ ("all")
  );
  const [statusFilter, setStatusFilter] = useState(
    /** @type {"all"|"active"|"completed"} */ ("all")
  );
  const [dueStatusFilter, setDueStatusFilter] = useState(
    /** @type {DueStatusFilter} */ ("all")
  );

  const [error, setError] = useState("");
  const [repo, setRepo] = useState(null);

  const [reminderToasts, setReminderToasts] = useState(
    /** @type {Array<{id: string, todoId: string, title: string, message: string}>} */ (
      []
    )
  );

  const inputRef = useRef(null);

  const stats = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter((t) => t.completed).length;
    const remaining = total - completed;
    return { total, completed, remaining };
  }, [todos]);

  const visibleTodos = useMemo(() => {
    return todos.filter((t) => {
      const normalizedPriority =
        t.priority === "low" || t.priority === "medium" || t.priority === "high"
          ? t.priority
          : "medium";

      const matchesPriority =
        priorityFilter === "all" ? true : normalizedPriority === priorityFilter;

      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? !t.completed
            : t.completed;

      const status = getDueStatus(t);
      const matchesDue =
        dueStatusFilter === "all"
          ? true
          : dueStatusFilter === "today"
            ? status === "today"
            : dueStatusFilter === "upcoming"
              ? status === "upcoming"
              : status === "overdue";

      return matchesPriority && matchesStatus && matchesDue;
    });
  }, [todos, priorityFilter, statusFilter, dueStatusFilter]);

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

  async function updateTodosAndPersist(updater) {
    setTodos((prev) => {
      const next = updater(prev);
      // Persist after state update decision.
      persist(next).catch((e) => setError(e?.message || "Failed to save changes."));
      return next;
    });
  }

  function addReminderToast(todo) {
    const toastId = generateId();
    setReminderToasts((prev) => [
      ...prev,
      {
        id: toastId,
        todoId: todo.id,
        title: "Reminder",
        message: `“${todo.title}” is due soon.`,
      },
    ]);

    // Auto-dismiss after a short period (non-blocking).
    window.setTimeout(() => {
      setReminderToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 6500);
  }

  // Reminder checks: every 60s, trigger once per task.
  useEffect(() => {
    if (!repo) return;

    const tick = () => {
      const nowMs = Date.now();

      // Find tasks whose reminder time has passed and hasn't triggered yet.
      const toTrigger = todos.filter((t) => {
        if (t.completed) return false;
        if (!t.reminderAt) return false;
        if (t.reminderTriggered) return false;
        const reminderMs = safeParseDateMs(t.reminderAt);
        if (reminderMs == null) return false;
        return reminderMs <= nowMs;
      });

      if (toTrigger.length === 0) return;

      // Show toasts and mark triggered in a single state update.
      updateTodosAndPersist((prev) => {
        const triggerSet = new Set(toTrigger.map((t) => t.id));
        const next = prev.map((t) =>
          triggerSet.has(t.id) ? { ...t, reminderTriggered: true } : t
        );
        return next;
      });

      toTrigger.forEach(addReminderToast);
    };

    // Run once immediately, then every 60s.
    tick();
    const interval = window.setInterval(tick, 60_000);

    return () => window.clearInterval(interval);
    // Intentionally include todos so newly loaded/edited reminders get checked promptly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, todos]);

  // PUBLIC_INTERFACE
  const addTodo = async () => {
    setError("");
    const title = normalizeTitle(newTitle);
    if (!title) {
      setError("Please enter a task.");
      return;
    }

    const now = Date.now();
    const dueDateIso = newDueDate ? buildLocalIsoFromDateAndTime(newDueDate, "00:00") : null;

    // If user provided a reminder time, schedule reminder on the selected due date (or today if no due date).
    // This keeps the UI simple: date + optional reminder time.
    const reminderBaseDate = newDueDate || "";
    const reminderAtIso =
      newReminderTime && reminderBaseDate
        ? buildLocalIsoFromDateAndTime(reminderBaseDate, newReminderTime)
        : null;

    const next = [
      ...todos,
      {
        id: generateId(),
        title,
        completed: false,
        priority: newPriority || "medium",
        createdAt: now,
        updatedAt: now,
        dueDate: dueDateIso,
        reminderAt: reminderAtIso,
        reminderTriggered: false,
      },
    ];

    setTodos(next);
    setNewTitle("");
    setNewPriority("medium");
    setNewDueDate("");
    setNewReminderTime("");
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

  function isoToLocalDateInputValue(isoString) {
    const ms = safeParseDateMs(isoString);
    if (ms == null) return "";
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function isoToLocalTimeInputValue(isoString) {
    const ms = safeParseDateMs(isoString);
    if (ms == null) return "";
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${min}`;
  }

  // PUBLIC_INTERFACE
  const startEdit = (todo) => {
    setError("");
    setEditingId(todo.id);
    setEditingTitle(todo.title);
    setEditingPriority(
      todo.priority === "low" || todo.priority === "medium" || todo.priority === "high"
        ? todo.priority
        : "medium"
    );

    setEditingDueDate(todo.dueDate ? isoToLocalDateInputValue(todo.dueDate) : "");
    setEditingReminderTime(todo.reminderAt ? isoToLocalTimeInputValue(todo.reminderAt) : "");
  };

  // PUBLIC_INTERFACE
  const cancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
    setEditingPriority("medium");
    setEditingDueDate("");
    setEditingReminderTime("");
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
    const dueDateIso = editingDueDate
      ? buildLocalIsoFromDateAndTime(editingDueDate, "00:00")
      : null;

    const reminderAtIso =
      editingReminderTime && editingDueDate
        ? buildLocalIsoFromDateAndTime(editingDueDate, editingReminderTime)
        : null;

    const next = todos.map((t) =>
      t.id === editingId
        ? {
            ...t,
            title,
            priority: editingPriority || "medium",
            updatedAt: now,
            dueDate: dueDateIso,
            reminderAt: reminderAtIso,
            // If reminder time changes, allow it to trigger again.
            reminderTriggered:
              reminderAtIso && t.reminderAt !== reminderAtIso ? false : Boolean(t.reminderTriggered),
          }
        : t
    );

    setTodos(next);
    setEditingId(null);
    setEditingTitle("");
    setEditingPriority("medium");
    setEditingDueDate("");
    setEditingReminderTime("");
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
        {/* Non-blocking reminder banner/toasts */}
        {reminderToasts.length ? (
          <div className="ReminderToasts" aria-label="Reminders" aria-live="polite">
            {reminderToasts.map((t) => (
              <div key={t.id} className="ReminderToast" role="status">
                <div className="ReminderToastTitle">
                  <FiBell className="UiIcon" aria-hidden="true" /> {t.title}
                </div>
                <div className="ReminderToastMsg">{t.message}</div>
                <button
                  type="button"
                  className="ReminderToastClose"
                  onClick={() =>
                    setReminderToasts((prev) => prev.filter((x) => x.id !== t.id))
                  }
                  aria-label="Dismiss reminder"
                  title="Dismiss"
                >
                  <FiX className="BtnIcon" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <header className="TodoHeader">
          <div className="TodoHeaderTop">
            <h1 className="TodoTitle">Todo List</h1>
            <span className="TodoPill" aria-label="Todo stats">
              {stats.remaining} remaining • {stats.completed}/{stats.total} done
            </span>
          </div>
          <p className="TodoSubtitle">
            Add tasks, edit them, mark complete, filter your view, and keep
            everything saved locally.
          </p>
        </header>

        <section className="FiltersRow" aria-label="Filters">
          <div className="FilterGroup">
            <label className="FilterLabel" htmlFor="priority-filter">
              <span className="LabelWithIcon">
                <FiFilter className="UiIcon" aria-hidden="true" />
                Priority
              </span>
            </label>
            <select
              id="priority-filter"
              className="TodoSelect"
              value={priorityFilter}
              onChange={(e) =>
                setPriorityFilter(
                  /** @type {"all" | Priority} */ (e.target.value)
                )
              }
              aria-label="Priority filter"
            >
              <option value="all">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div className="FilterGroup">
            <label className="FilterLabel" htmlFor="status-filter">
              <span className="LabelWithIcon">
                <FiFilter className="UiIcon" aria-hidden="true" />
                Status
              </span>
            </label>
            <select
              id="status-filter"
              className="TodoSelect"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  /** @type {"all"|"active"|"completed"} */ (e.target.value)
                )
              }
              aria-label="Status filter"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="FilterGroup">
            <label className="FilterLabel" htmlFor="due-filter">
              <span className="LabelWithIcon">
                <FiFilter className="UiIcon" aria-hidden="true" />
                Due
              </span>
            </label>
            <select
              id="due-filter"
              className="TodoSelect"
              value={dueStatusFilter}
              onChange={(e) =>
                setDueStatusFilter(/** @type {DueStatusFilter} */ (e.target.value))
              }
              aria-label="Due status filter"
            >
              <option value="all">All</option>
              <option value="today">Due today</option>
              <option value="upcoming">Upcoming</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
        </section>

        <div className="FiltersLegend" aria-label="Priority legend">
          <span className="FiltersLegendTitle">Legend:</span>
          <span title="Low priority">
            <span className="LegendDot low" aria-hidden="true" /> Low
          </span>
          <span title="Medium priority">
            <span className="LegendDot medium" aria-hidden="true" /> Medium
          </span>
          <span title="High priority">
            <span className="LegendDot high" aria-hidden="true" /> High
          </span>
        </div>

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

          <div className="AddActions">
            <label className="SrOnly" htmlFor="new-priority">
              Priority
            </label>
            <select
              id="new-priority"
              className="TodoSelect"
              value={newPriority}
              onChange={(e) =>
                setNewPriority(/** @type {Priority} */ (e.target.value))
              }
              aria-label="New task priority"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <label className="SrOnly" htmlFor="new-due-date">
              Due date
            </label>
            <input
              id="new-due-date"
              className="TodoInput"
              type="date"
              value={newDueDate}
              onChange={(e) => {
                setNewDueDate(e.target.value);
                // If due date is cleared, reminder time becomes meaningless.
                if (!e.target.value) setNewReminderTime("");
              }}
              aria-label="Due date"
              title="Due date"
            />

            <label className="SrOnly" htmlFor="new-reminder-time">
              Reminder time
            </label>
            <input
              id="new-reminder-time"
              className="TodoInput"
              type="time"
              value={newReminderTime}
              onChange={(e) => setNewReminderTime(e.target.value)}
              aria-label="Reminder time (optional)"
              title="Reminder time (optional)"
              disabled={!newDueDate}
            />

            <button
              className="Btn BtnPrimary BtnWithIcon"
              onClick={addTodo}
              type="button"
              aria-label="Add task"
              title="Add"
            >
              <FiPlus className="BtnIcon" aria-hidden="true" />
              <span>Add</span>
            </button>
          </div>
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
          ) : visibleTodos.length === 0 ? (
            <div className="TodoEmpty" role="status" aria-live="polite">
              <div className="TodoEmptyTitle">No matching tasks</div>
              <div className="TodoEmptyText">
                Try changing the Priority, Status, or Due filters.
              </div>
            </div>
          ) : (
            <ul className="TodoList">
              {visibleTodos.map((todo) => {
                const isEditing = editingId === todo.id;
                /** @type {Priority} */
                const priority =
                  todo.priority === "low" ||
                  todo.priority === "medium" ||
                  todo.priority === "high"
                    ? todo.priority
                    : "medium";

                const toggleLabel = todo.completed
                  ? "Mark as not completed"
                  : "Mark as completed";

                const dueBadge = getDueBadge(todo);

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
                        aria-label={toggleLabel}
                        title={toggleLabel}
                      >
                        {todo.completed ? (
                          <FiCheck className="ActionIcon success" aria-hidden="true" />
                        ) : (
                          <FiCircle className="ActionIcon" aria-hidden="true" />
                        )}
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

                            <div className="EditMetaRow" aria-label="Edit metadata">
                              <label
                                className="FilterLabel"
                                htmlFor={`edit-priority-${todo.id}`}
                              >
                                <span className="LabelWithIcon">
                                  <FiFilter className="UiIcon" aria-hidden="true" />
                                  Priority
                                </span>
                              </label>
                              <select
                                id={`edit-priority-${todo.id}`}
                                className="TodoSelect"
                                value={editingPriority}
                                onChange={(e) =>
                                  setEditingPriority(
                                    /** @type {Priority} */ (e.target.value)
                                  )
                                }
                                aria-label="Edit priority"
                              >
                                {PRIORITY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>

                              <label
                                className="FilterLabel"
                                htmlFor={`edit-due-${todo.id}`}
                              >
                                <span className="LabelWithIcon">
                                  <FiBell className="UiIcon" aria-hidden="true" />
                                  Due
                                </span>
                              </label>
                              <input
                                id={`edit-due-${todo.id}`}
                                className="TodoEditInput"
                                type="date"
                                value={editingDueDate}
                                onChange={(e) => {
                                  setEditingDueDate(e.target.value);
                                  if (!e.target.value) setEditingReminderTime("");
                                }}
                                aria-label="Edit due date"
                              />

                              <label
                                className="FilterLabel"
                                htmlFor={`edit-reminder-${todo.id}`}
                              >
                                <span className="LabelWithIcon">
                                  <FiBell className="UiIcon" aria-hidden="true" />
                                  Remind
                                </span>
                              </label>
                              <input
                                id={`edit-reminder-${todo.id}`}
                                className="TodoEditInput"
                                type="time"
                                value={editingReminderTime}
                                onChange={(e) => setEditingReminderTime(e.target.value)}
                                aria-label="Edit reminder time (optional)"
                                disabled={!editingDueDate}
                              />
                            </div>

                            <div className="EditActions">
                              <button
                                className="Btn BtnSuccess BtnWithIcon"
                                onClick={saveEdit}
                                type="button"
                                title="Save"
                                aria-label="Save edit"
                              >
                                <FiCheck className="BtnIcon" aria-hidden="true" />
                                <span>Save</span>
                              </button>
                              <button
                                className="Btn BtnGhost BtnWithIcon"
                                onClick={cancelEdit}
                                type="button"
                                title="Cancel"
                                aria-label="Cancel edit"
                              >
                                <FiX className="BtnIcon" aria-hidden="true" />
                                <span>Cancel</span>
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="TodoTextRow">
                              <div className="TodoText">{todo.title}</div>

                              <div className="TodoBadges" aria-label="Task badges">
                                {dueBadge ? (
                                  <span
                                    className={`DueBadge Due-${dueBadge.tone}`}
                                    aria-label={`Due status: ${dueBadge.text}`}
                                    title={dueBadge.text}
                                  >
                                    {dueBadge.text}
                                  </span>
                                ) : null}

                                <span
                                  className={`PriorityBadge Priority-${priority}`}
                                  aria-label={`Priority ${PRIORITY_LABELS[priority]}`}
                                  title={`Priority: ${PRIORITY_LABELS[priority]}`}
                                >
                                  {PRIORITY_LABELS[priority]}
                                </span>
                              </div>
                            </div>

                            <div className="CardActions">
                              <button
                                className="Btn BtnGhost BtnWithIcon"
                                onClick={() => startEdit(todo)}
                                type="button"
                                title="Edit"
                                aria-label="Edit task"
                              >
                                <FiEdit2 className="BtnIcon" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                              <button
                                className="Btn BtnDanger BtnWithIcon"
                                onClick={() => deleteTodo(todo.id)}
                                type="button"
                                title="Delete"
                                aria-label="Delete task"
                              >
                                <FiTrash2 className="BtnIcon" aria-hidden="true" />
                                <span>Delete</span>
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
            cancel editing. Set a due date to enable reminder time.
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
