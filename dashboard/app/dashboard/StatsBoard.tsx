"use client";

import { useEffect, useState } from "react";

type StatsOrder = {
  id: string;
  call_id?: string | null;
  order_type: "pickup" | "delivery";
  status: string;
  total: number;
  created_at: string;
  address?: string | null;
  deleted_at?: string | null;
  payment_method?: "efectivo" | "transferencia" | "tarjeta" | null;
  customers?: { name: string } | null;
};

type StatsCall = {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  status: string;
};

type Period = "day" | "week" | "month";

function hermosilloDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Hermosillo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return hermosilloDateKey(date);
}

function dateKeyFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function calendarCells(year: number, month: number) {
  const start = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array(start).fill(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(day);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function monthTitle(year: number, month: number) {
  const text = new Date(year, month, 1).toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric"
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

function inRange(key: string, start: string, end: string) {
  return key >= start && key <= end;
}

function formatDayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) {
    return `${secs} s`;
  }
  return `${mins} min ${secs.toString().padStart(2, "0")} s`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function soldTotal(
  list: StatsOrder[],
  methods?: Array<"efectivo" | "transferencia" | "tarjeta">
) {
  return list
    .filter(order => order.status !== "cancelled")
    .filter(order =>
      methods
        ? Boolean(
            order.payment_method && methods.includes(order.payment_method)
          )
        : true
    )
    .reduce((sum, order) => sum + Number(order.total), 0);
}

function changePercent(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return Math.round(((current - previous) / previous) * 100);
}

export default function StatsBoard({
  orders,
  calls,
  onOpenCall
}: {
  orders: StatsOrder[];
  calls: StatsCall[];
  minutesUsed?: number;
  minutesLimit?: number;
  onOpenCall?: (callId: string) => void;
}) {
  const today = hermosilloDateKey();
  const [period, setPeriod] = useState<Period>("day");
  const [selectedDay, setSelectedDay] = useState(today);
  const [weekStart, setWeekStart] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [picker, setPicker] = useState<Period | null>(null);
  const [pickerMonth, setPickerMonth] = useState(() => {
    const [year, month] = today.split("-").map(Number);
    return { year, month: month - 1 };
  });
  const [pickerYear, setPickerYear] = useState(() =>
    Number(today.slice(0, 4))
  );
  const [callSearchOpen, setCallSearchOpen] = useState(false);
  const [callQuery, setCallQuery] = useState("");

  const activeOrders = orders.filter(order => !order.deleted_at);

  const weekEnd = addDays(weekStart, 6);

  const periodOrders = activeOrders.filter(order => {
    const key = hermosilloDateKey(new Date(order.created_at));
    if (period === "day") {
      return key === selectedDay;
    }
    if (period === "week") {
      return inRange(key, weekStart, weekEnd);
    }
    return key.slice(0, 7) === selectedMonth;
  });
  const previousDay = addDays(selectedDay, -7);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekEnd, -7);
  const previousMonth = (() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const date = new Date(year, month - 2, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  })();
  const previousOrders = activeOrders.filter(order => {
    const key = hermosilloDateKey(new Date(order.created_at));
    if (period === "day") {
      return key === previousDay;
    }
    if (period === "week") {
      return inRange(key, previousWeekStart, previousWeekEnd);
    }
    return key.slice(0, 7) === previousMonth;
  });
  const periodCalls = calls.filter(call => {
    const key = hermosilloDateKey(new Date(call.started_at));
    if (period === "day") {
      return key === selectedDay;
    }
    if (period === "week") {
      return inRange(key, weekStart, weekEnd);
    }
    return key.slice(0, 7) === selectedMonth;
  });

  const callsWithCustomer = periodCalls.map(call => {
    const order = activeOrders.find(item => item.call_id === call.id);
    return {
      ...call,
      name: order?.customers?.name || "Sin nombre",
      address: order?.address?.trim() || "Sin dirección"
    };
  });

  const query = callQuery.trim().toLowerCase();
  const visibleCalls = query
    ? callsWithCustomer.filter(call =>
        `${call.name} ${call.address}`.toLowerCase().includes(query)
      )
    : callsWithCustomer;

  useEffect(() => {
    function closeSearch(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target && !target.closest(".stats-calls-head")) {
        setCallSearchOpen(false);
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCallSearchOpen(false);
        setPicker(null);
      }
    }

    document.addEventListener("mousedown", closeSearch);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", closeSearch);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("overlay-open", Boolean(picker));
    return () => document.body.classList.remove("overlay-open");
  }, [picker]);

  function openPicker(next: Period) {
    setPeriod(next);
    setPicker(next);
    if (next === "month") {
      setPickerYear(Number(selectedMonth.slice(0, 4)));
      return;
    }
    const key = next === "week" ? weekStart : selectedDay;
    const [year, month] = key.split("-").map(Number);
    setPickerMonth({ year, month: month - 1 });
  }

  const periodHint =
    period === "day"
      ? formatDayLabel(selectedDay)
      : period === "week"
        ? `${formatDayLabel(weekStart)} – ${formatDayLabel(weekEnd)}`
        : MONTHS[Number(selectedMonth.slice(5, 7)) - 1] +
          " " +
          selectedMonth.slice(0, 4);

  const soldOrders = periodOrders.filter(
    order => order.status !== "cancelled"
  );
  const soldCash = soldTotal(periodOrders, ["efectivo"]);
  const previousCash = soldTotal(previousOrders, ["efectivo"]);
  const cashChange = changePercent(soldCash, previousCash);
  const soldCard = soldTotal(periodOrders, ["tarjeta", "transferencia"]);
  const previousCard = soldTotal(previousOrders, ["tarjeta", "transferencia"]);
  const cardChange = changePercent(soldCard, previousCard);
  const compareHint =
    period === "day"
      ? `vs. ${formatDayLabel(previousDay)}`
      : period === "week"
        ? "vs. la semana anterior"
        : "vs. el mes anterior";
  const delivery = soldOrders.filter(
    order => order.order_type === "delivery"
  ).length;
  const pickup = soldOrders.filter(order => order.order_type === "pickup").length;
  const durations = periodCalls.map(call => Number(call.duration_seconds) || 0);
  const avgDuration =
    durations.length > 0
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 0;

  const byStatus = [
    ["new", "Nuevo"],
    ["preparing", "Preparando"],
    ["ready", "Listo"],
    ["delivering", "En camino"],
    ["completed", "Completado"],
    ["cancelled", "Cancelado"]
  ] as const;

  const statusCounts = byStatus.map(([value, label]) => ({
    label,
    count: periodOrders.filter(order => order.status === value).length
  }));
  const maxStatus = Math.max(1, ...statusCounts.map(row => row.count));

  return (
    <div className="stats-board">
      <div className="stats-period">
        <div className="stats-period-tabs">
        {(
          [
            ["day", "Día"],
            ["week", "Semana"],
            ["month", "Mes"]
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`stats-period-btn${period === value ? " is-active" : ""}`}
            onClick={() => openPicker(value)}
          >
            {label}
          </button>
        ))}
        </div>
        <p className="stats-period-hint">{periodHint}</p>
      </div>

      {picker && (
        <div
          className="stats-picker-overlay"
          onClick={() => setPicker(null)}
        >
          <div
            className="stats-picker"
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-label="Seleccionar periodo"
          >
            {picker !== "month" ? (
              <>
                <div className="orders-calendar-nav">
                  <button
                    type="button"
                    className="orders-calendar-nav-btn"
                    onClick={() =>
                      setPickerMonth(current => {
                        const next = new Date(current.year, current.month - 1, 1);
                        return {
                          year: next.getFullYear(),
                          month: next.getMonth()
                        };
                      })
                    }
                    aria-label="Mes anterior"
                  >
                    ‹
                  </button>
                  <p>{monthTitle(pickerMonth.year, pickerMonth.month)}</p>
                  <button
                    type="button"
                    className="orders-calendar-nav-btn"
                    onClick={() =>
                      setPickerMonth(current => {
                        const next = new Date(current.year, current.month + 1, 1);
                        return {
                          year: next.getFullYear(),
                          month: next.getMonth()
                        };
                      })
                    }
                    aria-label="Mes siguiente"
                  >
                    ›
                  </button>
                </div>
                <div className="orders-calendar-week">
                  {WEEKDAYS.map(day => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="orders-calendar-grid">
                  {calendarCells(pickerMonth.year, pickerMonth.month).map(
                    (day, index) => {
                      if (day == null) {
                        return <span key={`empty-${index}`} />;
                      }
                      const key = dateKeyFromParts(
                        pickerMonth.year,
                        pickerMonth.month,
                        day
                      );
                      const inWeek =
                        picker === "week" && inRange(key, weekStart, weekEnd);
                      const isSelected =
                        picker === "day"
                          ? key === selectedDay
                          : key === weekStart;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`orders-calendar-day${
                            isSelected ? " is-selected" : ""
                          }${inWeek && !isSelected ? " is-range" : ""}${
                            key === today ? " is-today" : ""
                          }`}
                          onClick={() => {
                            if (picker === "week") {
                              setWeekStart(key);
                            } else {
                              setSelectedDay(key);
                            }
                            setPicker(null);
                          }}
                        >
                          {day}
                        </button>
                      );
                    }
                  )}
                </div>
                <p className="stats-picker-note">
                  {picker === "week"
                    ? "Elige el primer día de la semana (7 días)."
                    : "Elige un día."}
                </p>
              </>
            ) : (
              <>
                <div className="orders-calendar-nav">
                  <button
                    type="button"
                    className="orders-calendar-nav-btn"
                    onClick={() => setPickerYear(year => year - 1)}
                    aria-label="Año anterior"
                  >
                    ‹
                  </button>
                  <p>{pickerYear}</p>
                  <button
                    type="button"
                    className="orders-calendar-nav-btn"
                    onClick={() => setPickerYear(year => year + 1)}
                    aria-label="Año siguiente"
                  >
                    ›
                  </button>
                </div>
                <div className="stats-month-grid">
                  {MONTHS.map((label, index) => {
                    const key = `${pickerYear}-${String(index + 1).padStart(2, "0")}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`stats-month-btn${
                          key === selectedMonth ? " is-selected" : ""
                        }`}
                        onClick={() => {
                          setSelectedMonth(key);
                          setPicker(null);
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="stats-scroll">
      <div className="stats-grid">
        <article className="stats-card">
          <p className="stats-label">Llamadas recibidas</p>
          <p className="stats-value">{periodCalls.length}</p>
        </article>
        <article className="stats-card">
          <p className="stats-label">Duración media</p>
          <p className="stats-value">{formatDuration(avgDuration)}</p>
        </article>
        <article className="stats-card">
          <p className="stats-label">Vendido en Efectivo</p>
          <p className="stats-value stats-value--money">
            {money(soldCash)}{" "}
            <span className="stats-mxn">MXN</span>
          </p>
          <p className={`stats-sub stats-compare${cashChange < 0 ? " is-down" : " is-up"}`}>
            {cashChange > 0 ? "+" : ""}
            {cashChange}% {compareHint}
          </p>
        </article>
        <article className="stats-card">
          <p className="stats-label">Vendido en Tarjeta o Transferencia</p>
          <p className="stats-value stats-value--money">
            {money(soldCard)}{" "}
            <span className="stats-mxn">MXN</span>
          </p>
          <p className={`stats-sub stats-compare${cardChange < 0 ? " is-down" : " is-up"}`}>
            {cardChange > 0 ? "+" : ""}
            {cardChange}% {compareHint}
          </p>
        </article>
        <article className="stats-card">
          <p className="stats-label">Domicilio</p>
          <p className="stats-value">{delivery}</p>
          <p className="stats-sub">
            {soldOrders.length
              ? Math.round((delivery / soldOrders.length) * 100)
              : 0}
            % de pedidos
          </p>
        </article>
        <article className="stats-card">
          <p className="stats-label">Recoger</p>
          <p className="stats-value">{pickup}</p>
          <p className="stats-sub">
            {soldOrders.length
              ? Math.round((pickup / soldOrders.length) * 100)
              : 0}
            % de pedidos
          </p>
        </article>
        <article className="stats-card stats-card--wide">
          <p className="stats-label">Pedidos por estado</p>
          <ul className="stats-bars">
            {statusCounts.map(row => (
              <li key={row.label}>
                <span>{row.label}</span>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{ width: `${(row.count / maxStatus) * 100}%` }}
                  />
                </div>
                <strong>{row.count}</strong>
              </li>
            ))}
          </ul>
        </article>
        <article className="stats-card stats-card--full">
          <div className="stats-calls-head">
            <p className="stats-label">Llamadas</p>
            <div className="stats-calls-search">
              <button
                type="button"
                className="orders-search-toggle"
                aria-label="Buscar llamada"
                onClick={() => setCallSearchOpen(open => !open)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M16 16l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              {callSearchOpen && (
                <input
                  id="call-search"
                  name="call-search"
                  type="search"
                  autoComplete="off"
                  className="orders-search-input"
                  autoFocus
                  placeholder="Buscar cliente o dirección…"
                  value={callQuery}
                  onChange={event => setCallQuery(event.target.value)}
                />
              )}
            </div>
          </div>
          {visibleCalls.length === 0 ? (
            <p className="stats-empty">
              {query
                ? "No hay llamadas que coincidan."
                : "No hay llamadas en este periodo."}
            </p>
          ) : (
            <ul className="stats-calls">
              {visibleCalls.map(call => (
                <li key={call.id}>
                  <button
                    type="button"
                    className="stats-call-row"
                    onClick={() => onOpenCall?.(call.id)}
                  >
                    <div className="stats-call-main">
                      <strong>{call.name}</strong>
                      <span>
                        {new Date(call.started_at).toLocaleTimeString("es-MX", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </span>
                      <b>{formatDuration(Number(call.duration_seconds) || 0)}</b>
                    </div>
                    <p className="stats-call-address">{call.address}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
      </div>
    </div>
  );
}
