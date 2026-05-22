import { useMemo, useState, useRef, useCallback, useEffect } from "react";

type WaitlistStatus = "WAITLISTED" | "SCHEDULED" | "REMOVED";
type DayCode = "M" | "Tu" | "W" | "Th" | "F";
type ViewMode = "CALENDAR" | "WAITLIST";
type ActionMode = "OPENING" | "WAITLIST_ENTRY" | "EDIT_PROVIDERS";
type SortField = "dateAdded" | "name" | "provider" | "tier" | "status";

type WaitlistEntry = {
  id: number;
  dateAdded: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  availableDays: DayCode[];
  availableTimes: string[];
  status: WaitlistStatus;
};

type Provider = {
  name: string;
  color: string;
};

type Opening = {
  id: number;
  provider: string;
  date: string;
  day: DayCode;
  startTime: string;
  endTime: string;
};

type OpeningSegment = {
  opening: Opening;
  startTime: string;
  endTime: string;
  left: string;
  width: string;
  widthPercent: number;
  index: number;
  showLabel: boolean;
  isFirstPiece: boolean;
  isLastPiece: boolean;
};

type EditingOpening = Opening & { _original?: Opening };
type EditingEntry = WaitlistEntry;
type EditingProvider = Provider & { _originalName?: string };

const dayLabels: { code: DayCode; label: string }[] = [
  { code: "M", label: "Mon" },
  { code: "Tu", label: "Tue" },
  { code: "W", label: "Wed" },
  { code: "Th", label: "Thu" },
  { code: "F", label: "Fri" },
];

const timeSlots = ["8:00","9:00","10:00","11:00","12:00","1:00","2:00","3:00","4:00","5:00"];
const ALL_TIME_OPTIONS = ["8:00","9:00","10:00","11:00","12:00","1:00","2:00","3:00","4:00","5:00","6:00"];

// Calendar spans 8:00 to 18:00 (10 hours)
const CAL_START_MIN = 8 * 60;   // 480
const CAL_END_MIN   = 18 * 60;  // 1080
const CAL_SPAN      = CAL_END_MIN - CAL_START_MIN; // 600 min

// Snap to 15-minute intervals
const SNAP = 15;

function snapToInterval(minutes: number, interval: number) {
  return Math.round(minutes / interval) * interval;
}

function App() {
  const [activeView, setActiveView] = useState<ViewMode>("CALENDAR");
  const [actionMode, setActionMode] = useState<ActionMode>("OPENING");
  const [isActionPageOpen, setIsActionPageOpen] = useState(false);
  const [calendarLocked, setCalendarLocked] = useState(false);

  // Edit modals
  const [editingOpening, setEditingOpening] = useState<EditingOpening | null>(null);
  const [editingEntry, setEditingEntry]     = useState<EditingEntry | null>(null);
  const [editingProvider, setEditingProvider] = useState<EditingProvider | null>(null);

  const [providers, setProviders] = useState<Provider[]>([
    { name: "Provider A", color: "#5877ff" },
    { name: "Provider B", color: "#c9a227" },
  ]);

  const [providerName, setProviderName]   = useState("");
  const [providerColor, setProviderColor] = useState("#5877ff");

  const [openingProvider, setOpeningProvider]   = useState("Provider A");
  const [openingDate, setOpeningDate]           = useState("2026-05-29");
  const [openingStartTime, setOpeningStartTime] = useState("9:00");
  const [openingEndTime, setOpeningEndTime]     = useState("10:00");

  const [waitlistDateAdded, setWaitlistDateAdded]           = useState(toDateInputValue(new Date()));
  const [waitlistFirstName, setWaitlistFirstName]           = useState("");
  const [waitlistLastName, setWaitlistLastName]             = useState("");
  const [waitlistProvider, setWaitlistProvider]             = useState("Provider A");
  const [waitlistTier, setWaitlistTier]                     = useState<1 | 2 | 3>(1);
  const [waitlistReason, setWaitlistReason]                 = useState(getTierReason(1));
  const [waitlistAvailableDays, setWaitlistAvailableDays]   = useState<DayCode[]>([]);
  const [waitlistAvailableTimesText, setWaitlistAvailableTimesText] = useState("");

  const [weekStartDate, setWeekStartDate]     = useState<string>("2026-05-25");
  const [selectedOpeningId, setSelectedOpeningId] = useState<number | null>(1);
  const [hoveredOpeningId, setHoveredOpeningId]   = useState<number | null>(null);

  const [sortField, setSortField]         = useState<SortField>("dateAdded");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [entries, setEntries] = useState<WaitlistEntry[]>([
    { id: 1, dateAdded: "2026-05-22", firstName: "John",   lastName: "Smith",  provider: "Provider A", tier: 1, reason: getTierReason(1), availableDays: [],           availableTimes: [],            status: "WAITLISTED" },
    { id: 2, dateAdded: "2026-05-20", firstName: "Mary",   lastName: "Adams",  provider: "Provider A", tier: 2, reason: getTierReason(2), availableDays: ["Tu","Th"],   availableTimes: ["9:00-12:00","2:00-5:00"], status: "WAITLISTED" },
    { id: 3, dateAdded: "2026-05-18", firstName: "Alex",   lastName: "Rivera", provider: "Provider B", tier: 1, reason: getTierReason(1), availableDays: [],           availableTimes: [],            status: "WAITLISTED" },
    { id: 4, dateAdded: "2026-05-16", firstName: "Sarah",  lastName: "Miller", provider: "Provider B", tier: 3, reason: getTierReason(3), availableDays: ["Th","F"],   availableTimes: ["1:00-4:00"], status: "WAITLISTED" },
    { id: 5, dateAdded: "2026-05-15", firstName: "Daniel", lastName: "Clark",  provider: "Provider A", tier: 1, reason: getTierReason(1), availableDays: [],           availableTimes: [],            status: "WAITLISTED" },
  ]);

  const [openings, setOpenings] = useState<Opening[]>([
    { id: 1, provider: "Provider A", date: "2026-05-26", day: "Tu", startTime: "9:00",  endTime: "1:00"  },
    { id: 2, provider: "Provider B", date: "2026-05-28", day: "Th", startTime: "8:00",  endTime: "10:00" },
    { id: 3, provider: "Provider B", date: "2026-05-28", day: "Th", startTime: "1:00",  endTime: "4:00"  },
    { id: 4, provider: "Provider A", date: "2026-05-28", day: "Th", startTime: "9:00",  endTime: "11:00" },
  ]);

  // ── Drag state ──────────────────────────────────────────────────────
  type DragState = {
    openingId: number;
    mode: "move" | "resize-top" | "resize-bottom";
    startY: number;
    origStartMin: number;
    origEndMin: number;
    colHeightPx: number;
  };
  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // Pointer move handler (attached to window)
  const handlePointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const dyPx   = e.clientY - d.startY;
    const dyMin  = (dyPx / d.colHeightPx) * CAL_SPAN;
    const minDur = 30;

    setOpenings(prev => prev.map(o => {
      if (o.id !== d.openingId) return o;
      let newStart = d.origStartMin;
      let newEnd   = d.origEndMin;

      if (d.mode === "move") {
        const dur = d.origEndMin - d.origStartMin;
        newStart  = snapToInterval(d.origStartMin + dyMin, SNAP);
        newEnd    = newStart + dur;
        if (newStart < CAL_START_MIN) { newStart = CAL_START_MIN; newEnd = newStart + dur; }
        if (newEnd   > CAL_END_MIN)   { newEnd   = CAL_END_MIN;   newStart = newEnd - dur; }
      } else if (d.mode === "resize-top") {
        newStart = snapToInterval(d.origStartMin + dyMin, SNAP);
        newStart = Math.max(CAL_START_MIN, Math.min(newStart, d.origEndMin - minDur));
      } else {
        newEnd = snapToInterval(d.origEndMin + dyMin, SNAP);
        newEnd = Math.min(CAL_END_MIN, Math.max(newEnd, d.origStartMin + minDur));
      }

      return {
        ...o,
        startTime: minutesToTimeString(newStart),
        endTime:   minutesToTimeString(newEnd),
      };
    }));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setDraggingId(null);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup",   handlePointerUp);
  }, [handlePointerMove]);

  function startDrag(
    e: React.PointerEvent,
    opening: Opening,
    mode: DragState["mode"],
    colHeightPx: number,
  ) {
    if (calendarLocked) return;
    e.stopPropagation();
    dragRef.current = {
      openingId:    opening.id,
      mode,
      startY:       e.clientY,
      origStartMin: timeToMinutes(opening.startTime),
      origEndMin:   timeToMinutes(opening.endTime),
      colHeightPx,
    };
    setDraggingId(opening.id);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup",   handlePointerUp);
  }

  // ── Week navigation ───────────────────────────────────────────────
  const weekDates = useMemo(() => {
    const start = parseLocalDate(weekStartDate);
    return dayLabels.map((day, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return { ...day, date, dateString: toDateInputValue(date) };
    });
  }, [weekStartDate]);

  const selectedOpening = openings.find(o => o.id === selectedOpeningId) ?? null;

  const eligibleEntries = useMemo(() => {
    if (!selectedOpening) return [];
    return entries
      .filter(e => e.status === "WAITLISTED")
      .filter(e => e.provider === selectedOpening.provider)
      .filter(e => isEntryAvailableForOpening(e, selectedOpening))
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
      });
  }, [entries, selectedOpening]);

  const sortedWaitlistEntries = useMemo(() => {
    const waitlistedOnly = entries.filter(e => e.status === "WAITLISTED");
    return [...waitlistedOnly].sort((a, b) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      if (sortField === "dateAdded") return (new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()) * dir;
      if (sortField === "name")      return getFullName(a).localeCompare(getFullName(b)) * dir;
      if (sortField === "provider")  return a.provider.localeCompare(b.provider) * dir;
      if (sortField === "tier")      return (a.tier - b.tier) * dir;
      return a.status.localeCompare(b.status) * dir;
    });
  }, [entries, sortField, sortDirection]);

  // ── Mutations ────────────────────────────────────────────────────
  function goToPreviousWeek() { setWeekStartDate(d => moveDateByDays(d, -7)); setSelectedOpeningId(null); }
  function goToNextWeek()     { setWeekStartDate(d => moveDateByDays(d,  7)); setSelectedOpeningId(null); }

  function markScheduled(id: number) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "SCHEDULED" } : e));
  }

  function scheduleEntryForSelectedOpening(entryId: number) {
    if (selectedOpeningId === null) return;
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, status: "SCHEDULED" } : e));
    setOpenings(prev => prev.filter(o => o.id !== selectedOpeningId));
    setSelectedOpeningId(null);
  }

  function removeEntry(id: number) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "REMOVED" } : e));
  }

  function removeOpening(id: number) {
    setOpenings(prev => prev.filter(o => o.id !== id));
    if (selectedOpeningId === id) setSelectedOpeningId(null);
  }

  function addProvider() {
    const cleanName = providerName.trim();
    if (!cleanName) return;
    if (providers.some(p => p.name.toLowerCase() === cleanName.toLowerCase())) return;
    setProviders(prev => [...prev, { name: cleanName, color: providerColor }]);
    setProviderName("");
    setProviderColor("#5877ff");
  }

  function removeProvider(name: string) {
    setProviders(prev => prev.filter(p => p.name !== name));
    setOpenings(prev => prev.filter(o => o.provider !== name));
    if (openingProvider === name) {
      const fallback = providers.find(p => p.name !== name)?.name ?? "";
      setOpeningProvider(fallback);
    }
  }

  function addOpening() {
    if (!openingProvider || !openingDate || !openingStartTime || !openingEndTime) return;
    if (timeToMinutes(openingEndTime) <= timeToMinutes(openingStartTime)) return;
    const nextOpening: Opening = {
      id:        getNextId(openings),
      provider:  openingProvider,
      date:      openingDate,
      day:       getDayCodeFromDate(openingDate),
      startTime: openingStartTime,
      endTime:   openingEndTime,
    };
    setOpenings(prev => [...prev, nextOpening]);
  }

  function toggleWaitlistAvailableDay(day: DayCode) {
    setWaitlistAvailableDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  }

  function addWaitlistEntry() {
    const firstName = waitlistFirstName.trim();
    const lastName  = waitlistLastName.trim();
    const reason    = waitlistReason.trim();
    const availableTimes = waitlistAvailableTimesText.split(",").map(t => t.trim()).filter(Boolean);
    if (!waitlistDateAdded || !firstName || !lastName || !waitlistProvider || !reason) return;
    const nextEntry: WaitlistEntry = {
      id:            getNextId(entries),
      dateAdded:     waitlistDateAdded,
      firstName,
      lastName,
      provider:      waitlistProvider,
      tier:          waitlistTier,
      reason,
      availableDays: waitlistAvailableDays,
      availableTimes,
      status:        "WAITLISTED",
    };
    setEntries(prev => [...prev, nextEntry]);
    setWaitlistFirstName("");
    setWaitlistLastName("");
    setWaitlistTier(1);
    setWaitlistReason(getTierReason(1));
    setWaitlistAvailableDays([]);
    setWaitlistAvailableTimesText("");
    setActiveView("WAITLIST");
    setIsActionPageOpen(false);
  }

  function handleSortChange(next: SortField) {
    if (next === sortField) { setSortDirection(d => d === "asc" ? "desc" : "asc"); return; }
    setSortField(next);
    setSortDirection("asc");
  }

  function openActionPage() {
    setActionMode(activeView === "WAITLIST" ? "WAITLIST_ENTRY" : "OPENING");
    setIsActionPageOpen(true);
  }

  // ── Edit opening save ─────────────────────────────────────────────
  function saveEditingOpening() {
    if (!editingOpening) return;
    if (timeToMinutes(editingOpening.endTime) <= timeToMinutes(editingOpening.startTime)) return;
    setOpenings(prev => prev.map(o => o.id === editingOpening.id ? {
      ...editingOpening,
      day: getDayCodeFromDate(editingOpening.date),
    } : o));
    setEditingOpening(null);
  }

  // ── Edit entry save ───────────────────────────────────────────────
  function saveEditingEntry() {
    if (!editingEntry) return;
    setEntries(prev => prev.map(e => e.id === editingEntry.id ? editingEntry : e));
    setEditingEntry(null);
  }

  // ── Edit provider save ────────────────────────────────────────────
  function saveEditingProvider() {
    if (!editingProvider) return;
    const oldName = editingProvider._originalName ?? editingProvider.name;
    const newName = editingProvider.name.trim();
    if (!newName) return;
    setProviders(prev => prev.map(p => p.name === oldName ? { name: newName, color: editingProvider.color } : p));
    // Update references in openings and entries
    if (oldName !== newName) {
      setOpenings(prev => prev.map(o => o.provider === oldName ? { ...o, provider: newName } : o));
      setEntries(prev => prev.map(e => e.provider === oldName ? { ...e, provider: newName } : e));
    }
    setEditingProvider(null);
  }

  const openingDurationLabel = (() => {
    const diff = (timeToMinutes(openingEndTime) - timeToMinutes(openingStartTime)) / 60;
    if (diff <= 0) return "—";
    if (diff === 1) return "1 hr";
    if (diff % 1 === 0) return `${diff} hrs`;
    return `${diff.toFixed(1)} hrs`;
  })();

  const waitlistInitials = (waitlistFirstName[0] ?? "") + (waitlistLastName[0] ?? "");

  const cornerActionLabel = activeView === "WAITLIST" ? "+ Add to Waitlist" : "+ Add Opening";

  // Ref for day body height measurement
  const dayBodyRef = useRef<HTMLDivElement>(null);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <nav className="main-nav">
          <button className={activeView === "CALENDAR" ? "nav-button active" : "nav-button"}
            onClick={() => { setActiveView("CALENDAR"); setIsActionPageOpen(false); }}>
            Calendar
          </button>
          <button className={activeView === "WAITLIST" ? "nav-button active" : "nav-button"}
            onClick={() => { setActiveView("WAITLIST"); setIsActionPageOpen(false); }}>
            Waitlist
          </button>
        </nav>
        <button className="corner-action-button" onClick={openActionPage}>{cornerActionLabel}</button>
      </header>

      {/* ── CALENDAR VIEW ─────────────────────────────────────── */}
      {!isActionPageOpen && activeView === "CALENDAR" && (
        <section className="calendar-page">
          <aside className="legend-panel">
            <h2>Legend</h2>
            <div className="provider-list">
              {providers.map(p => (
                <div className="provider-key" key={p.name}>
                  <span>{p.name}</span>
                  <span className="provider-color" style={{ backgroundColor: p.color }} />
                </div>
              ))}
            </div>

            {/* Lock toggle */}
            <div className="lock-section">
              <button
                className={`lock-button ${calendarLocked ? "locked" : "unlocked"}`}
                onClick={() => setCalendarLocked(l => !l)}
                title={calendarLocked ? "Unlock to drag openings" : "Lock to prevent accidental moves"}
              >
                <span className="lock-icon">{calendarLocked ? "🔒" : "🔓"}</span>
                <span className="lock-label">{calendarLocked ? "Locked" : "Unlocked"}</span>
              </button>
              {!calendarLocked && (
                <p className="lock-hint">Drag openings to move or resize</p>
              )}
            </div>

            <button className="secondary-button" onClick={() => { setActionMode("EDIT_PROVIDERS"); setIsActionPageOpen(true); }}>
              Edit Providers
            </button>
          </aside>

          <section className="calendar-panel">
            <div className="week-controls">
              <button className="arrow-button" onClick={goToPreviousWeek}>←</button>
              <h1>Week of {formatDisplayDate(weekStartDate)}</h1>
              <button className="arrow-button" onClick={goToNextWeek}>→</button>
            </div>

            <div className="calendar-grid">
              {weekDates.map(day => {
                const dayOpenings   = openings.filter(o => o.date === day.dateString);
                const openingSegments = buildOpeningSegments(dayOpenings);

                return (
                  <div className="day-column" key={day.dateString}>
                    <div className="day-header">
                      <span>{day.label}</span>
                      <strong>{day.date.getDate()}</strong>
                    </div>

                    <div className="day-body" ref={dayBodyRef}>
                      {timeSlots.map(time => (
                        <div className="time-row" key={time}><span>{time}</span></div>
                      ))}

                      {openingSegments.map(segment => {
                        const color = providers.find(p => p.name === segment.opening.provider)?.color ?? "#999";
                        const isDragging = draggingId === segment.opening.id;
                        const opening    = openings.find(o => o.id === segment.opening.id) ?? segment.opening;

                        // Recalculate position based on live opening state during drag
                        const liveTop    = getOpeningTopPct(opening.startTime);
                        const liveHeight = getOpeningHeightPct(opening.startTime, opening.endTime);

                        return (
                          <div
                            key={`${segment.opening.id}-${segment.startTime}-${segment.index}`}
                            className={[
                              "opening-block",
                              selectedOpeningId === segment.opening.id ? "selected" : "",
                              hoveredOpeningId  === segment.opening.id ? "opening-hovered" : "",
                              segment.isFirstPiece ? "first-piece" : "",
                              segment.isLastPiece  ? "last-piece"  : "",
                              isDragging ? "is-dragging" : "",
                              calendarLocked ? "is-locked" : "is-draggable",
                            ].join(" ")}
                            style={{
                              backgroundColor: color,
                              top:    isDragging ? `${liveTop}%`    : `${getOpeningTopPct(segment.startTime)}%`,
                              height: isDragging ? `${liveHeight}%` : `${getOpeningHeightPct(segment.startTime, segment.endTime)}%`,
                              left:   segment.left,
                              width:  segment.width,
                              right:  "auto",
                            }}
                            onClick={() => {
                              if (!isDragging) setSelectedOpeningId(segment.opening.id);
                            }}
                            onMouseEnter={() => setHoveredOpeningId(segment.opening.id)}
                            onMouseLeave={() => setHoveredOpeningId(null)}
                          >
                            {/* Top resize handle */}
                            {!calendarLocked && segment.isFirstPiece && (
                              <div
                                className="resize-handle resize-top"
                                onPointerDown={e => {
                                  const col = e.currentTarget.closest(".day-body") as HTMLElement;
                                  startDrag(e, opening, "resize-top", col?.getBoundingClientRect().height ?? 600);
                                }}
                              />
                            )}

                            {/* Move handle / label area */}
                            <div
                              className="opening-move-area"
                              onPointerDown={e => {
                                const col = e.currentTarget.closest(".day-body") as HTMLElement;
                                startDrag(e, opening, "move", col?.getBoundingClientRect().height ?? 600);
                              }}
                            >
                              {segment.showLabel && (
                                <>
                                  <span className="opening-label-provider">{opening.provider}</span>
                                  <span className="opening-label-time">
                                    {opening.startTime}–{opening.endTime}
                                  </span>
                                </>
                              )}
                            </div>

                            {/* Edit button (visible on hover) */}
                            {segment.showLabel && (
                              <button
                                className="opening-edit-btn"
                                onClick={e => {
                                  e.stopPropagation();
                                  setEditingOpening({ ...opening, _original: opening });
                                }}
                                title="Edit opening"
                              >
                                ✎
                              </button>
                            )}

                            {/* Bottom resize handle */}
                            {!calendarLocked && segment.isLastPiece && (
                              <div
                                className="resize-handle resize-bottom"
                                onPointerDown={e => {
                                  const col = e.currentTarget.closest(".day-body") as HTMLElement;
                                  startDrag(e, opening, "resize-bottom", col?.getBoundingClientRect().height ?? 600);
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="eligible-panel">
            {selectedOpening ? (
              <>
                <div className="selected-opening-header">
                  <h2>{selectedOpening.provider}</h2>
                  <p>{selectedOpening.day} · {formatDisplayDate(selectedOpening.date)}</p>
                  <p>{selectedOpening.startTime}–{selectedOpening.endTime}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="edit-opening-btn-small"
                      onClick={() => setEditingOpening({ ...selectedOpening, _original: selectedOpening })}>
                      Edit
                    </button>
                    <button className="remove-opening-button" onClick={() => removeOpening(selectedOpening.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                <h3>Eligible Waitlist</h3>
                {eligibleEntries.length === 0 ? (
                  <p className="empty-message">No eligible waitlist entries for this opening.</p>
                ) : (
                  <div className="eligible-list">
                    {eligibleEntries.map(entry => (
                      <article className="eligible-card" key={entry.id}>
                        <div className="eligible-card-top">
                          <h4 className="eligible-patient-name">{getFullName(entry)}</h4>
                          <span className={`tier-badge tier-${entry.tier}`}>Tier {entry.tier}</span>
                        </div>
                        <div className="eligible-card-middle">
                          <p className="eligible-reason">{entry.reason}</p>
                          <button className="eligible-schedule-button"
                            onClick={() => scheduleEntryForSelectedOpening(entry.id)}>
                            Schedule
                          </button>
                        </div>
                        <p className="eligible-availability">
                          Available: {formatAvailability(entry.availableDays, entry.availableTimes)}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="empty-message">Select a provider opening to see eligible patients.</p>
            )}
          </aside>
        </section>
      )}

      {/* ── WAITLIST VIEW ─────────────────────────────────────── */}
      {!isActionPageOpen && activeView === "WAITLIST" && (
        <section className="waitlist-page">
          <div className="page-header-row">
            <h1>Waitlist</h1>
          </div>
          <table>
            <thead>
              <tr>
                <th><button className="table-sort-button" onClick={() => handleSortChange("dateAdded")}>Date Added {getSortIndicator(sortField, sortDirection, "dateAdded")}</button></th>
                <th><button className="table-sort-button" onClick={() => handleSortChange("name")}>Name {getSortIndicator(sortField, sortDirection, "name")}</button></th>
                <th><button className="table-sort-button" onClick={() => handleSortChange("provider")}>Provider {getSortIndicator(sortField, sortDirection, "provider")}</button></th>
                <th><button className="table-sort-button" onClick={() => handleSortChange("tier")}>Tier {getSortIndicator(sortField, sortDirection, "tier")}</button></th>
                <th>Reason</th>
                <th>Dates</th>
                <th>Times</th>
                <th><button className="table-sort-button" onClick={() => handleSortChange("status")}>Status {getSortIndicator(sortField, sortDirection, "status")}</button></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedWaitlistEntries.map(entry => (
                <tr key={entry.id}>
                  <td>{entry.dateAdded}</td>
                  <td>{getFullName(entry)}</td>
                  <td>{entry.provider}</td>
                  <td><span className={`tier-badge tier-${entry.tier}`}>Tier {entry.tier}</span></td>
                  <td>{entry.reason}</td>
                  <td>{entry.availableDays.join(", ") || "Any"}</td>
                  <td>{entry.availableTimes.join(", ") || "Any"}</td>
                  <td>{entry.status}</td>
                  <td>
                    <button onClick={() => setEditingEntry({ ...entry })}>Edit</button>
                    <button onClick={() => markScheduled(entry.id)}>Schedule</button>
                    <button onClick={() => removeEntry(entry.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── ACTION PAGES ──────────────────────────────────────── */}
      {isActionPageOpen && (
        <section className="action-page">

          {/* ADD OPENING */}
          {actionMode === "OPENING" && (
            <>
              <div className="action-header-row">
                <div>
                  <h1 className="action-page-title">Add Opening</h1>
                  <p className="action-page-subtitle">Schedule a new provider availability block</p>
                </div>
                <button className="close-action-button" onClick={() => setIsActionPageOpen(false)}>×</button>
              </div>

              <div className="form-section-label">Opening details</div>
              <div className="form-row" style={{ marginBottom: 16 }}>
                <label className="field-label-block">
                  <span className="field-label-text">Provider</span>
                  <select value={openingProvider} onChange={e => setOpeningProvider(e.target.value)}>
                    {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </label>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">Date</span>
                  <input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} />
                </label>
              </div>
              <div className="form-row" style={{ marginBottom: 28 }}>
                <label className="field-label-block">
                  <span className="field-label-text">Start time</span>
                  <select value={openingStartTime} onChange={e => setOpeningStartTime(e.target.value)}>
                    {ALL_TIME_OPTIONS.slice(0,-1).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="field-label-block">
                  <span className="field-label-text">End time</span>
                  <select value={openingEndTime} onChange={e => setOpeningEndTime(e.target.value)}>
                    {ALL_TIME_OPTIONS.slice(1).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <div className="time-range-preview">
                  <span className="time-range-val">{openingStartTime}</span>
                  <span className="time-range-sep">→</span>
                  <span className="time-range-val">{openingEndTime}</span>
                  <span className="duration-badge">{openingDurationLabel}</span>
                </div>
              </div>
              <div className="form-submit-row">
                <button className="btn-secondary" onClick={() => setIsActionPageOpen(false)}>Cancel</button>
                <button className="btn-primary" onClick={addOpening}>+ Add Opening</button>
              </div>
              <div className="form-divider" />
              <div className="items-section">
                <div className="items-section-header">
                  <div className="form-section-label" style={{ margin:0, border:"none", padding:0 }}>Existing openings</div>
                  <span className="items-count">{openings.length} opening{openings.length !== 1 ? "s" : ""}</span>
                </div>
                {openings.length === 0 ? (
                  <p className="empty-message">No openings yet.</p>
                ) : openings.map(o => {
                  const color = providers.find(p => p.name === o.provider)?.color ?? "#999";
                  return (
                    <div className="item-row" key={o.id}>
                      <span className="item-dot" style={{ backgroundColor: color }} />
                      <span className="item-name">{o.provider}</span>
                      <span className="item-meta">{formatDisplayDate(o.date)}</span>
                      <span className="item-meta">{o.startTime} – {o.endTime}</span>
                      <button className="item-edit-btn" onClick={() => { setEditingOpening({ ...o, _original: o }); setIsActionPageOpen(false); }}>Edit</button>
                      <button className="item-remove-btn" onClick={() => removeOpening(o.id)}>Remove</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* EDIT PROVIDERS */}
          {actionMode === "EDIT_PROVIDERS" && (
            <>
              <div className="action-header-row">
                <div>
                  <h1 className="action-page-title">Edit Providers</h1>
                  <p className="action-page-subtitle">Manage provider names and calendar colors</p>
                </div>
                <button className="close-action-button" onClick={() => setIsActionPageOpen(false)}>×</button>
              </div>
              <div className="form-section-label">Add provider</div>
              <div className="form-row" style={{ marginBottom: 24, alignItems: "flex-end" }}>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">Provider name</span>
                  <input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="e.g. Dr. Patel" />
                </label>
                <label className="field-label-block">
                  <span className="field-label-text">Calendar color</span>
                  <div className="color-field-row">
                    <span className="color-swatch" style={{ backgroundColor: providerColor }} />
                    <input type="color" value={providerColor} onChange={e => setProviderColor(e.target.value)} style={{ flex: 1 }} />
                  </div>
                </label>
                <button className="btn-primary" onClick={addProvider} style={{ alignSelf: "flex-end" }}>+ Add Provider</button>
              </div>
              {providerName.trim() && (
                <div className="name-preview-bar" style={{ marginBottom: 20 }}>
                  <span className="color-swatch" style={{ backgroundColor: providerColor }} />
                  <span className="name-preview-text">Preview: <strong>{providerName.trim()}</strong></span>
                  <span className="color-hex-badge" style={{ backgroundColor: providerColor + "22", color: providerColor }}>{providerColor}</span>
                </div>
              )}
              <div className="form-divider" />
              <div className="items-section">
                <div className="items-section-header">
                  <div className="form-section-label" style={{ margin:0, border:"none", padding:0 }}>Current providers</div>
                  <span className="items-count">{providers.length} provider{providers.length !== 1 ? "s" : ""}</span>
                </div>
                {providers.map(provider => (
                  <div className="item-row" key={provider.name}>
                    <span className="item-dot" style={{ backgroundColor: provider.color }} />
                    <span className="item-name">{provider.name}</span>
                    <span className="item-color-swatch" style={{ backgroundColor: provider.color }} />
                    <span className="item-meta">{provider.color}</span>
                    <button className="item-edit-btn" onClick={() => setEditingProvider({ ...provider, _originalName: provider.name })}>Edit</button>
                    <button className="item-remove-btn" onClick={() => removeProvider(provider.name)}>Remove</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ADD TO WAITLIST */}
          {actionMode === "WAITLIST_ENTRY" && (
            <>
              <div className="action-header-row">
                <div>
                  <h1 className="action-page-title">Add to Waitlist</h1>
                  <p className="action-page-subtitle">Register a new patient for provider availability</p>
                </div>
                <button className="close-action-button" onClick={() => setIsActionPageOpen(false)}>×</button>
              </div>
              <div className="form-section-label">Patient</div>
              <div className="form-row" style={{ marginBottom: 16 }}>
                <label className="field-label-block">
                  <span className="field-label-text">Date added</span>
                  <input type="date" value={waitlistDateAdded} onChange={e => setWaitlistDateAdded(e.target.value)} />
                </label>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">First name</span>
                  <input value={waitlistFirstName} onChange={e => setWaitlistFirstName(e.target.value)} placeholder="First name" />
                </label>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">Last name</span>
                  <input value={waitlistLastName} onChange={e => setWaitlistLastName(e.target.value)} placeholder="Last name" />
                </label>
              </div>
              {(waitlistFirstName || waitlistLastName) && (
                <div className="name-preview-bar" style={{ marginBottom: 16 }}>
                  <div className="name-avatar">{waitlistInitials.toUpperCase() || "–"}</div>
                  <span className="name-preview-text">Patient: <strong>{[waitlistLastName, waitlistFirstName].filter(Boolean).join(", ")}</strong></span>
                </div>
              )}
              <div className="form-row" style={{ marginBottom: 24 }}>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">Provider</span>
                  <select value={waitlistProvider} onChange={e => setWaitlistProvider(e.target.value)}>
                    {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </label>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">Reason</span>
                  <input value={waitlistReason} onChange={e => setWaitlistReason(e.target.value)} placeholder="Reason" />
                </label>
              </div>
              <div className="form-section-label">Priority tier</div>
              <div className="tier-card-grid" style={{ marginBottom: 24 }}>
                {([1,2,3] as const).map(tier => (
                  <button key={tier}
                    className={["tier-card", waitlistTier === tier ? `tier-card-selected tier-${tier}-selected` : ""].join(" ")}
                    onClick={() => { setWaitlistTier(tier); setWaitlistReason(getTierReason(tier)); }}>
                    <div className="tier-card-top">
                      <span className="tier-card-num">Tier {tier}</span>
                      <span className={`tier-badge tier-${tier}`}>{getTierReason(tier)}</span>
                    </div>
                    <div className="tier-card-desc">
                      {tier === 1 && "Schedule immediately"}
                      {tier === 2 && "Within a few weeks"}
                      {tier === 3 && "Standard scheduling"}
                    </div>
                  </button>
                ))}
              </div>
              <div className="form-section-label">Availability</div>
              <div style={{ marginBottom: 14 }}>
                <div className="field-label-text" style={{ marginBottom: 8 }}>Available days</div>
                <div className="day-pill-group">
                  {dayLabels.map(day => (
                    <button key={day.code}
                      className={["day-pill", waitlistAvailableDays.includes(day.code) ? "day-pill-selected" : ""].join(" ")}
                      onClick={() => toggleWaitlistAvailableDay(day.code)}>
                      {day.label}
                    </button>
                  ))}
                </div>
                <p className="field-hint">Leave blank to indicate any day</p>
              </div>
              <label className="field-label-block" style={{ maxWidth: 520, marginBottom: 28 }}>
                <span className="field-label-text">Available times</span>
                <input value={waitlistAvailableTimesText} onChange={e => setWaitlistAvailableTimesText(e.target.value)}
                  placeholder="e.g. 9:00-12:00, 2:00-5:00 — leave blank for any time" />
              </label>
              <div className="form-submit-row">
                <button className="btn-secondary" onClick={() => setIsActionPageOpen(false)}>Cancel</button>
                <button className="btn-primary" onClick={addWaitlistEntry}>+ Add to Waitlist</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── EDIT OPENING MODAL ──────────────────────────────────── */}
      {editingOpening && (
        <div className="modal-backdrop" onClick={() => setEditingOpening(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Opening</h2>
              <button className="close-action-button" onClick={() => setEditingOpening(null)}>×</button>
            </div>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Provider</span>
                <select value={editingOpening.provider}
                  onChange={e => setEditingOpening({ ...editingOpening, provider: e.target.value })}>
                  {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Date</span>
                <input type="date" value={editingOpening.date}
                  onChange={e => setEditingOpening({ ...editingOpening, date: e.target.value })} />
              </label>
            </div>
            <div className="form-row" style={{ marginBottom: 20 }}>
              <label className="field-label-block">
                <span className="field-label-text">Start time</span>
                <select value={editingOpening.startTime}
                  onChange={e => setEditingOpening({ ...editingOpening, startTime: e.target.value })}>
                  {ALL_TIME_OPTIONS.slice(0,-1).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="field-label-block">
                <span className="field-label-text">End time</span>
                <select value={editingOpening.endTime}
                  onChange={e => setEditingOpening({ ...editingOpening, endTime: e.target.value })}>
                  {ALL_TIME_OPTIONS.slice(1).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setEditingOpening(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveEditingOpening}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT ENTRY MODAL ────────────────────────────────────── */}
      {editingEntry && (
        <div className="modal-backdrop" onClick={() => setEditingEntry(null)}>
          <div className="modal-box modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Waitlist Entry</h2>
              <button className="close-action-button" onClick={() => setEditingEntry(null)}>×</button>
            </div>
            <div className="form-section-label">Patient</div>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label className="field-label-block">
                <span className="field-label-text">Date added</span>
                <input type="date" value={editingEntry.dateAdded}
                  onChange={e => setEditingEntry({ ...editingEntry, dateAdded: e.target.value })} />
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">First name</span>
                <input value={editingEntry.firstName}
                  onChange={e => setEditingEntry({ ...editingEntry, firstName: e.target.value })} />
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Last name</span>
                <input value={editingEntry.lastName}
                  onChange={e => setEditingEntry({ ...editingEntry, lastName: e.target.value })} />
              </label>
            </div>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Provider</span>
                <select value={editingEntry.provider}
                  onChange={e => setEditingEntry({ ...editingEntry, provider: e.target.value })}>
                  {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Reason</span>
                <input value={editingEntry.reason}
                  onChange={e => setEditingEntry({ ...editingEntry, reason: e.target.value })} />
              </label>
            </div>
            <div className="form-section-label">Priority tier</div>
            <div className="tier-card-grid" style={{ marginBottom: 18 }}>
              {([1,2,3] as const).map(tier => (
                <button key={tier}
                  className={["tier-card", editingEntry.tier === tier ? `tier-card-selected tier-${tier}-selected` : ""].join(" ")}
                  onClick={() => setEditingEntry({ ...editingEntry, tier, reason: getTierReason(tier) })}>
                  <div className="tier-card-top">
                    <span className="tier-card-num">Tier {tier}</span>
                    <span className={`tier-badge tier-${tier}`}>{getTierReason(tier)}</span>
                  </div>
                  <div className="tier-card-desc">
                    {tier === 1 && "Schedule immediately"}
                    {tier === 2 && "Within a few weeks"}
                    {tier === 3 && "Standard scheduling"}
                  </div>
                </button>
              ))}
            </div>
            <div className="form-section-label">Availability</div>
            <div style={{ marginBottom: 12 }}>
              <div className="field-label-text" style={{ marginBottom: 8 }}>Available days</div>
              <div className="day-pill-group">
                {dayLabels.map(day => (
                  <button key={day.code}
                    className={["day-pill", editingEntry.availableDays.includes(day.code) ? "day-pill-selected" : ""].join(" ")}
                    onClick={() => setEditingEntry({
                      ...editingEntry,
                      availableDays: editingEntry.availableDays.includes(day.code)
                        ? editingEntry.availableDays.filter(d => d !== day.code)
                        : [...editingEntry.availableDays, day.code],
                    })}>
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-label-block" style={{ maxWidth: 520, marginBottom: 20 }}>
              <span className="field-label-text">Available times</span>
              <input value={editingEntry.availableTimes.join(", ")}
                onChange={e => setEditingEntry({
                  ...editingEntry,
                  availableTimes: e.target.value.split(",").map(t => t.trim()).filter(Boolean),
                })}
                placeholder="e.g. 9:00-12:00, 2:00-5:00" />
            </label>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setEditingEntry(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveEditingEntry}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT PROVIDER MODAL ─────────────────────────────────── */}
      {editingProvider && (
        <div className="modal-backdrop" onClick={() => setEditingProvider(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Provider</h2>
              <button className="close-action-button" onClick={() => setEditingProvider(null)}>×</button>
            </div>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Provider name</span>
                <input value={editingProvider.name}
                  onChange={e => setEditingProvider({ ...editingProvider, name: e.target.value })} />
              </label>
            </div>
            <div className="form-row" style={{ marginBottom: 20 }}>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Calendar color</span>
                <div className="color-field-row">
                  <span className="color-swatch" style={{ backgroundColor: editingProvider.color }} />
                  <input type="color" value={editingProvider.color}
                    onChange={e => setEditingProvider({ ...editingProvider, color: e.target.value })}
                    style={{ flex: 1 }} />
                </div>
              </label>
              <div className="name-preview-bar" style={{ flex: 1, alignSelf: "flex-end" }}>
                <span className="color-swatch" style={{ backgroundColor: editingProvider.color }} />
                <span className="name-preview-text">Preview: <strong>{editingProvider.name || "—"}</strong></span>
                <span className="color-hex-badge" style={{ backgroundColor: editingProvider.color + "22", color: editingProvider.color }}>
                  {editingProvider.color}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setEditingProvider(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveEditingProvider}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function getFullName(entry: WaitlistEntry) { return `${entry.lastName}, ${entry.firstName}`; }

function getTierReason(tier: 1 | 2 | 3) {
  if (tier === 1) return "Urgent";
  if (tier === 2) return "Semi-urgent";
  return "Routine";
}

function parseLocalDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function moveDateByDays(dateString: string, days: number) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function formatDisplayDate(dateString: string) {
  return parseLocalDate(dateString).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function timeToMinutes(time: string) {
  const [hourString, minuteString] = time.split(":");
  let hour = Number(hourString);
  const minute = Number(minuteString ?? "0");
  if (hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + minute;
}

function minutesToTimeString(totalMinutes: number) {
  let hour   = Math.floor(totalMinutes / 60);
  const min  = totalMinutes % 60;
  const disp = hour > 12 ? hour - 12 : hour;
  return `${disp}:${String(min).padStart(2,"0")}`;
}

function minutesToDisplayTime(totalMinutes: number) {
  return minutesToTimeString(totalMinutes);
}

function getOpeningTopPct(startTime: string) {
  return ((timeToMinutes(startTime) - CAL_START_MIN) / CAL_SPAN) * 100;
}

function getOpeningHeightPct(startTime: string, endTime: string) {
  return ((timeToMinutes(endTime) - timeToMinutes(startTime)) / CAL_SPAN) * 100;
}

function parseTimeRange(range: string) {
  const [start, end] = range.split("-");
  return { start: timeToMinutes(start), end: timeToMinutes(end) };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function isEntryAvailableForOpening(entry: WaitlistEntry, opening: Opening) {
  const isFlexibleUrgent = entry.tier === 1 && entry.availableDays.length === 0 && entry.availableTimes.length === 0;
  if (isFlexibleUrgent) return true;
  const dayMatches = entry.availableDays.length === 0 || entry.availableDays.includes(opening.day);
  if (!dayMatches) return false;
  if (entry.availableTimes.length === 0) return true;
  const openingStart = timeToMinutes(opening.startTime);
  const openingEnd   = timeToMinutes(opening.endTime);
  return entry.availableTimes.some(range => {
    const { start, end } = parseTimeRange(range);
    return rangesOverlap(start, end, openingStart, openingEnd);
  });
}

function formatAvailability(days: DayCode[], times: string[]) {
  return `${days.length > 0 ? days.join(", ") : "Any"}; ${times.length > 0 ? times.join(", ") : "Any"}`;
}

function getOpeningBreakpoints(dayOpenings: Opening[]) {
  const points = new Set<number>();
  dayOpenings.forEach(o => { points.add(timeToMinutes(o.startTime)); points.add(timeToMinutes(o.endTime)); });
  return [...points].sort((a,b) => a-b);
}

function buildOpeningSegments(dayOpenings: Opening[]): OpeningSegment[] {
  const breakpoints = getOpeningBreakpoints(dayOpenings);
  const rawSegments: OpeningSegment[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const segStart = breakpoints[i];
    const segEnd   = breakpoints[i+1];
    const activeOpenings = dayOpenings
      .filter(o => timeToMinutes(o.startTime) < segEnd && timeToMinutes(o.endTime) > segStart)
      .sort((a,b) => {
        const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        return diff !== 0 ? diff : a.provider.localeCompare(b.provider);
      });
    activeOpenings.forEach((opening, index) => {
      const count = activeOpenings.length;
      rawSegments.push({
        opening,
        startTime:    minutesToDisplayTime(segStart),
        endTime:      minutesToDisplayTime(segEnd),
        left:         `calc(${(index/count)*100}% + 4px)`,
        width:        `calc(${100/count}% - 8px)`,
        widthPercent: 100/count,
        index,
        showLabel:    false,
        isFirstPiece: false,
        isLastPiece:  false,
      });
    });
  }
  return labelAndConnectOpeningSegments(mergeAdjacentOpeningSegments(rawSegments));
}

function mergeAdjacentOpeningSegments(segments: OpeningSegment[]) {
  const merged: OpeningSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.opening.id === seg.opening.id && prev.endTime === seg.startTime && prev.left === seg.left && prev.width === seg.width) {
      prev.endTime = seg.endTime;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function labelAndConnectOpeningSegments(segments: OpeningSegment[]) {
  return segments.map(segment => {
    const same = segments.filter(s => s.opening.id === segment.opening.id);
    const first = same.reduce((b,c) => timeToMinutes(c.startTime) < timeToMinutes(b.startTime) ? c : b);
    const last  = same.reduce((b,c) => timeToMinutes(c.endTime)   > timeToMinutes(b.endTime)   ? c : b);
    const label = same.reduce((b,c) => {
      if (c.widthPercent > b.widthPercent) return c;
      const bDur = timeToMinutes(b.endTime) - timeToMinutes(b.startTime);
      const cDur = timeToMinutes(c.endTime) - timeToMinutes(c.startTime);
      return (c.widthPercent === b.widthPercent && cDur > bDur) ? c : b;
    });
    return {
      ...segment,
      showLabel: segment.startTime === label.startTime && segment.endTime === label.endTime && segment.left === label.left,
      isFirstPiece: segment.startTime === first.startTime && segment.left === first.left && segment.width === first.width,
      isLastPiece:  segment.endTime   === last.endTime   && segment.left === last.left   && segment.width === last.width,
    };
  });
}

function getSortIndicator(current: SortField, direction: "asc"|"desc", column: SortField) {
  if (current !== column) return "";
  return direction === "asc" ? "↑" : "↓";
}

function getNextId(items: { id: number }[]) {
  return items.length === 0 ? 1 : Math.max(...items.map(i => i.id)) + 1;
}

function getDayCodeFromDate(dateString: string): DayCode {
  const day = parseLocalDate(dateString).getDay();
  if (day === 1) return "M";
  if (day === 2) return "Tu";
  if (day === 3) return "W";
  if (day === 4) return "Th";
  return "F";
}

export default App;