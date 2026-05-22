import { useMemo, useState } from "react";
import "./App.css";

/*
  Appointment Management System frontend.

  Current scope:
  - Frontend only.
  - No database yet.
  - Waitlist entries and provider openings are stored in React state.
  - Calendar view shows provider openings.
  - Clicking an opening shows eligible waitlist entries on the right.
  - Scheduling from an opening removes that opening.
  - Waitlist view shows sortable waitlisted patients.
  - Corner action button changes based on the active page.
*/

type WaitlistStatus = "WAITLISTED" | "SCHEDULED" | "REMOVED";
type DayCode = "M" | "Tu" | "W" | "Th" | "F";
type ViewMode = "CALENDAR" | "WAITLIST" | "ACTION";
type ActionMode = "OPENING" | "WAITLIST_ENTRY";
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

// Providers shown in the legend and used to color openings
const providers: Provider[] = [
  { name: "Provider A", color: "#5877ff" },
  { name: "Provider B", color: "#c9a227" },
];

// Calendar days shown in the work week
const dayLabels: { code: DayCode; label: string }[] = [
  { code: "M", label: "Mon" },
  { code: "Tu", label: "Tue" },
  { code: "W", label: "Wed" },
  { code: "Th", label: "Thu" },
  { code: "F", label: "Fri" },
];

// Visible calendar time rows
const timeSlots = [
  "8:00",
  "9:00",
  "10:00",
  "11:00",
  "12:00",
  "1:00",
  "2:00",
  "3:00",
  "4:00",
  "5:00",
];

function App() {
  // Tracks which main page is visible
  const [activeView, setActiveView] = useState<ViewMode>("CALENDAR");

  // Tracks which action page mode is active
  const [actionMode, setActionMode] = useState<ActionMode>("OPENING");

  // Tracks the Monday date for the visible week
  const [weekStartDate, setWeekStartDate] = useState<string>("2026-05-25");

  // Tracks the selected opening on the calendar
  const [selectedOpeningId, setSelectedOpeningId] = useState<number | null>(1);

  // Tracks which opening is being hovered across visual segments
  const [hoveredOpeningId, setHoveredOpeningId] = useState<number | null>(null);

  // Tracks the active waitlist sort field
  const [sortField, setSortField] = useState<SortField>("dateAdded");

  // Tracks the active waitlist sort direction
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Temporary waitlist entries until database support is added
  const [entries, setEntries] = useState<WaitlistEntry[]>([
    {
      id: 1,
      dateAdded: "2026-05-22",
      firstName: "John",
      lastName: "Smith",
      provider: "Provider A",
      tier: 1,
      reason: getTierReason(1),
      availableDays: [],
      availableTimes: [],
      status: "WAITLISTED",
    },
    {
      id: 2,
      dateAdded: "2026-05-20",
      firstName: "Mary",
      lastName: "Adams",
      provider: "Provider A",
      tier: 2,
      reason: getTierReason(2),
      availableDays: ["Tu", "Th"],
      availableTimes: ["9:00-12:00", "2:00-5:00"],
      status: "WAITLISTED",
    },
    {
      id: 3,
      dateAdded: "2026-05-18",
      firstName: "Alex",
      lastName: "Rivera",
      provider: "Provider B",
      tier: 1,
      reason: getTierReason(1),
      availableDays: [],
      availableTimes: [],
      status: "WAITLISTED",
    },
    {
      id: 4,
      dateAdded: "2026-05-16",
      firstName: "Sarah",
      lastName: "Miller",
      provider: "Provider B",
      tier: 3,
      reason: getTierReason(3),
      availableDays: ["Th", "F"],
      availableTimes: ["1:00-4:00"],
      status: "WAITLISTED",
    },
    {
      id: 5,
      dateAdded: "2026-05-15",
      firstName: "Daniel",
      lastName: "Clark",
      provider: "Provider A",
      tier: 1,
      reason: getTierReason(1),
      availableDays: [],
      availableTimes: [],
      status: "WAITLISTED",
    },
  ]);

  // Temporary opening entries until database support is added
  const [openings, setOpenings] = useState<Opening[]>([
    {
      id: 1,
      provider: "Provider A",
      date: "2026-05-26",
      day: "Tu",
      startTime: "9:00",
      endTime: "1:00",
    },
    {
      id: 2,
      provider: "Provider B",
      date: "2026-05-28",
      day: "Th",
      startTime: "8:00",
      endTime: "10:00",
    },
    {
      id: 3,
      provider: "Provider B",
      date: "2026-05-28",
      day: "Th",
      startTime: "1:00",
      endTime: "4:00",
    },
    {
      id: 4,
      provider: "Provider A",
      date: "2026-05-28",
      day: "Th",
      startTime: "9:00",
      endTime: "11:00",
    },
  ]);

  // Builds the five visible calendar dates from the selected week start
  const weekDates = useMemo(() => {
    const start = parseLocalDate(weekStartDate);
    return dayLabels.map((day, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return { ...day, date, dateString: toDateInputValue(date) };
    });
  }, [weekStartDate]);

  // Finds the currently selected opening object
  const selectedOpening = openings.find((o) => o.id === selectedOpeningId) ?? null;

  // Finds waitlisted people who match the selected opening
  const eligibleEntries = useMemo(() => {
    if (!selectedOpening) return [];
    return entries
      .filter((e) => e.status === "WAITLISTED")
      .filter((e) => e.provider === selectedOpening.provider)
      .filter((e) => isEntryAvailableForOpening(e, selectedOpening))
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
      });
  }, [entries, selectedOpening]);

  // Builds the sorted waitlist table
  const sortedWaitlistEntries = useMemo(() => {
    const waitlistedOnly = entries.filter((e) => e.status === "WAITLISTED");
    return [...waitlistedOnly].sort((a, b) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      if (sortField === "dateAdded") {
        return (new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()) * dir;
      }
      if (sortField === "name") {
        return getFullName(a).localeCompare(getFullName(b)) * dir;
      }
      if (sortField === "provider") {
        return a.provider.localeCompare(b.provider) * dir;
      }
      if (sortField === "tier") {
        return (a.tier - b.tier) * dir;
      }
      return a.status.localeCompare(b.status) * dir;
    });
  }, [entries, sortField, sortDirection]);

  // Moves the calendar back one week
  function goToPreviousWeek() {
    setWeekStartDate((d) => moveDateByDays(d, -7));
    setSelectedOpeningId(null);
  }

  // Moves the calendar forward one week
  function goToNextWeek() {
    setWeekStartDate((d) => moveDateByDays(d, 7));
    setSelectedOpeningId(null);
  }

  // Marks an entry as scheduled without changing openings
  function markScheduled(id: number) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: "SCHEDULED" } : e)));
  }

  // Schedules a waitlist entry and removes the selected opening
  function scheduleEntryForSelectedOpening(entryId: number) {
    if (selectedOpeningId === null) return;
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, status: "SCHEDULED" } : e))
    );
    setOpenings((prev) => prev.filter((o) => o.id !== selectedOpeningId));
    setSelectedOpeningId(null);
  }

  // Marks an entry as removed without deleting its record
  function removeEntry(id: number) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: "REMOVED" } : e)));
  }

  // Removes an opening from the calendar
  function removeOpening(id: number) {
    setOpenings((prev) => prev.filter((o) => o.id !== id));
    if (selectedOpeningId === id) {
      setSelectedOpeningId(null);
    }
  }

  // Toggles sort direction when clicking the same column
  function handleSortChange(next: SortField) {
    if (next === sortField) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(next);
    setSortDirection("asc");
  }

  // Opens the action page in the correct mode
  function openActionPage() {
    setActionMode(activeView === "WAITLIST" ? "WAITLIST_ENTRY" : "OPENING");
    setActiveView("ACTION");
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <nav className="main-nav">
          <button
            className={activeView === "CALENDAR" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("CALENDAR")}
          >
            Calendar
          </button>

          <button
            className={activeView === "WAITLIST" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("WAITLIST")}
          >
            Waitlist
          </button>
        </nav>

        <button className="corner-action-button" onClick={openActionPage}>
          {activeView === "WAITLIST" ? "+ Add to Waitlist" : "+ Add Opening"}
        </button>
      </header>

      {activeView === "CALENDAR" && (
        <section className="calendar-page">
          <aside className="legend-panel">
            <h2>Legend</h2>

            <div className="provider-list">
              {providers.map((p) => (
                <div className="provider-key" key={p.name}>
                  <span>{p.name}</span>
                  <span className="provider-color" style={{ backgroundColor: p.color }} />
                </div>
              ))}
            </div>

            <button className="secondary-button">Edit Providers</button>
          </aside>

          <section className="calendar-panel">
            <div className="week-controls">
              <button className="arrow-button" onClick={goToPreviousWeek}>
                ←
              </button>

              <h1>Week of {formatDisplayDate(weekStartDate)}</h1>

              <button className="arrow-button" onClick={goToNextWeek}>
                →
              </button>
            </div>

            <div className="calendar-grid">
              {weekDates.map((day) => {
                const dayOpenings = openings.filter((o) => o.date === day.dateString);
                const openingSegments = buildOpeningSegments(dayOpenings);

                return (
                  <div className="day-column" key={day.dateString}>
                    <div className="day-header">
                      <span>{day.label}</span>
                      <strong>{day.date.getDate()}</strong>
                    </div>

                    <div className="day-body">
                      {timeSlots.map((time) => (
                        <div className="time-row" key={time}>
                          <span>{time}</span>
                        </div>
                      ))}

                      {openingSegments.map((segment) => {
                        const color =
                          providers.find((p) => p.name === segment.opening.provider)?.color ??
                          "#999";

                        return (
                          <button
                            key={`${segment.opening.id}-${segment.startTime}-${segment.endTime}-${segment.index}`}
                            className={[
                              "opening-block",
                              selectedOpeningId === segment.opening.id ? "selected" : "",
                              hoveredOpeningId === segment.opening.id ? "opening-hovered" : "",
                              segment.isFirstPiece ? "first-piece" : "",
                              segment.isLastPiece ? "last-piece" : "",
                            ].join(" ")}
                            style={{
                              backgroundColor: color,
                              top: `${getOpeningTop(segment.startTime)}%`,
                              height: `${getOpeningHeight(segment.startTime, segment.endTime)}%`,
                              left: segment.left,
                              width: segment.width,
                              right: "auto",
                            }}
                            onClick={() => setSelectedOpeningId(segment.opening.id)}
                            onMouseEnter={() => setHoveredOpeningId(segment.opening.id)}
                            onMouseLeave={() => setHoveredOpeningId(null)}
                          >
                            {segment.showLabel && (
                              <>
                                <span>{segment.opening.provider}</span>
                                <span>
                                  {formatTime(segment.opening.startTime)}–{formatTime(segment.opening.endTime)}
                                </span>
                              </>
                            )}
                          </button>
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
                  <p>
                    {selectedOpening.day} · {formatDisplayDate(selectedOpening.date)}
                  </p>
                  <p>
                    {formatTime(selectedOpening.startTime)}–{formatTime(selectedOpening.endTime)}
                  </p>

                  <button
                    className="remove-opening-button"
                    onClick={() => removeOpening(selectedOpening.id)}
                  >
                    Remove Opening
                  </button>
                </div>
                <h3>Eligible Waitlist</h3>
                {eligibleEntries.length === 0 ? (
                  <p className="empty-message">No eligible waitlist entries for this opening.</p>
                ) : (
                  <div className="eligible-list">
                    {eligibleEntries.map((entry) => (
                      <article className="eligible-card" key={entry.id}>
                        <div>
                          <h4>{getFullName(entry)}</h4>
                          <span className={`tier-badge tier-${entry.tier}`}>
                            Tier {entry.tier}
                          </span>
                          <p>{entry.reason}</p>
                          <p>
                            Available:{" "}
                            {formatAvailability(entry.availableDays, entry.availableTimes)}
                          </p>
                        </div>
                        <button onClick={() => scheduleEntryForSelectedOpening(entry.id)}>
                          Schedule
                        </button>
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
      {activeView === "WAITLIST" && (
        <section className="waitlist-page">
          <div className="page-header-row">
            <h1>Waitlist</h1>
          </div>
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className="table-sort-button"
                    onClick={() => handleSortChange("dateAdded")}
                  >
                    Date Added {getSortIndicator(sortField, sortDirection, "dateAdded")}
                  </button>
                </th>
                <th>
                  <button className="table-sort-button" onClick={() => handleSortChange("name")}>
                    Name {getSortIndicator(sortField, sortDirection, "name")}
                  </button>
                </th>
                <th>
                  <button
                    className="table-sort-button"
                    onClick={() => handleSortChange("provider")}
                  >
                    Provider {getSortIndicator(sortField, sortDirection, "provider")}
                  </button>
                </th>
                <th>
                  <button className="table-sort-button" onClick={() => handleSortChange("tier")}>
                    Tier {getSortIndicator(sortField, sortDirection, "tier")}
                  </button>
                </th>
                <th>Reason</th>
                <th>Dates</th>
                <th>Times</th>
                <th>
                  <button className="table-sort-button" onClick={() => handleSortChange("status")}>
                    Status {getSortIndicator(sortField, sortDirection, "status")}
                  </button>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedWaitlistEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.dateAdded}</td>
                  <td>{getFullName(entry)}</td>
                  <td>{entry.provider}</td>
                  <td>
                    <span className={`tier-badge tier-${entry.tier}`}>Tier {entry.tier}</span>
                  </td>
                  <td>{entry.reason}</td>
                  <td>{entry.availableDays.join(", ") || "Any"}</td>
                  <td>{entry.availableTimes.join(", ") || "Any"}</td>
                  <td>{entry.status}</td>
                  <td>
                    <button onClick={() => markScheduled(entry.id)}>Schedule</button>
                    <button onClick={() => removeEntry(entry.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {activeView === "ACTION" && (
        <section className="action-page">
          {actionMode === "OPENING" ? (
            <>
              <h1>Add / Remove Opening</h1>
              <p>Placeholder — form for provider, date, start time, and end time goes here.</p>
              <div className="opening-list">
                {openings.map((o) => (
                  <article className="opening-list-card" key={o.id}>
                    <strong>{o.provider}</strong>
                    <span>{o.date}</span>
                    <span>
                      {formatTime(o.startTime)}–{formatTime(o.endTime)}
                    </span>
                    <button onClick={() => removeOpening(o.id)}>Remove</button>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1>Add to Waitlist</h1>
              <p>
                Placeholder — form for date added, patient name, provider, tier, reason, available
                dates, and times goes here.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}

// Builds a display name in last-name-first format
function getFullName(entry: WaitlistEntry) {
  return `${entry.lastName}, ${entry.firstName}`;
}

// Returns the default reason label for each tier
function getTierReason(tier: 1 | 2 | 3) {
  if (tier === 1) return "Urgent";
  if (tier === 2) return "Semi-urgent";
  return "Routine";
}

// Parses YYYY-MM-DD as a local date
function parseLocalDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Converts a Date object to YYYY-MM-DD
function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Moves a YYYY-MM-DD date by a number of days
function moveDateByDays(dateString: string, days: number) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

// Formats a YYYY-MM-DD date for display
function formatDisplayDate(dateString: string) {
  const date = parseLocalDate(dateString);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Returns display time as stored
function formatTime(time: string) {
  return time;
}

// Converts clinic display time to minutes after midnight
function timeToMinutes(time: string) {
  const [hourString, minuteString] = time.split(":");
  let hour = Number(hourString);
  const minute = Number(minuteString);
  if (hour >= 1 && hour <= 7) {
    hour += 12;
  }
  return hour * 60 + minute;
}

// Converts minutes after midnight to clinic display time
function minutesToDisplayTime(totalMinutes: number) {
  let hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  if (hour > 12) {
    hour -= 12;
  }
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

// Parses a time range like 9:00-12:00
function parseTimeRange(range: string) {
  const [start, end] = range.split("-");
  return { start: timeToMinutes(start), end: timeToMinutes(end) };
}

// Checks whether two time ranges overlap
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

// Checks if a waitlist entry is available for an opening
function isEntryAvailableForOpening(entry: WaitlistEntry, opening: Opening) {
  const isFlexibleUrgent =
    entry.tier === 1 && entry.availableDays.length === 0 && entry.availableTimes.length === 0;
  if (isFlexibleUrgent) return true;
  const dayMatches = entry.availableDays.length === 0 || entry.availableDays.includes(opening.day);
  if (!dayMatches) return false;
  if (entry.availableTimes.length === 0) return true;
  const openingStart = timeToMinutes(opening.startTime);
  const openingEnd = timeToMinutes(opening.endTime);
  return entry.availableTimes.some((range) => {
    const { start, end } = parseTimeRange(range);
    return rangesOverlap(start, end, openingStart, openingEnd);
  });
}

// Calculates vertical offset for an opening block
function getOpeningTop(startTime: string) {
  const calStart = timeToMinutes("8:00");
  const calEnd = timeToMinutes("6:00");
  return ((timeToMinutes(startTime) - calStart) / (calEnd - calStart)) * 100;
}

// Calculates vertical height for an opening block
function getOpeningHeight(startTime: string, endTime: string) {
  const calStart = timeToMinutes("8:00");
  const calEnd = timeToMinutes("6:00");
  return ((timeToMinutes(endTime) - timeToMinutes(startTime)) / (calEnd - calStart)) * 100;
}

// Formats waitlist availability for cards
function formatAvailability(days: DayCode[], times: string[]) {
  const dayText = days.length > 0 ? days.join(", ") : "Any";
  const timeText = times.length > 0 ? times.join(", ") : "Any";
  return `${dayText}; ${timeText}`;
}

// Creates all start/end split points for one day
function getOpeningBreakpoints(dayOpenings: Opening[]) {
  const points = new Set<number>();
  dayOpenings.forEach((opening) => {
    points.add(timeToMinutes(opening.startTime));
    points.add(timeToMinutes(opening.endTime));
  });
  return [...points].sort((a, b) => a - b);
}

// Builds visual segments so openings regain full width after overlaps end
function buildOpeningSegments(dayOpenings: Opening[]): OpeningSegment[] {
  const breakpoints = getOpeningBreakpoints(dayOpenings);
  const rawSegments: OpeningSegment[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const segmentStart = breakpoints[i];
    const segmentEnd = breakpoints[i + 1];
    const activeOpenings = dayOpenings
      .filter((opening) => {
        const openingStart = timeToMinutes(opening.startTime);
        const openingEnd = timeToMinutes(opening.endTime);
        return openingStart < segmentEnd && openingEnd > segmentStart;
      })
      .sort((a, b) => {
        const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        if (startDiff !== 0) return startDiff;
        return a.provider.localeCompare(b.provider);
      });
    activeOpenings.forEach((opening, index) => {
      const count = activeOpenings.length;
      rawSegments.push({
        opening,
        startTime: minutesToDisplayTime(segmentStart),
        endTime: minutesToDisplayTime(segmentEnd),
        left: `calc(${(index / count) * 100}% + 4px)`,
        width: `calc(${100 / count}% - 8px)`,
        widthPercent: 100 / count,
        index,
        showLabel: false,
        isFirstPiece: false,
        isLastPiece: false,
      });
    });
  }
  return labelAndConnectOpeningSegments(mergeAdjacentOpeningSegments(rawSegments));
}

// Combines adjacent pieces when the opening keeps the same layout
function mergeAdjacentOpeningSegments(segments: OpeningSegment[]) {
  const merged: OpeningSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const canMerge =
      previous &&
      previous.opening.id === segment.opening.id &&
      previous.endTime === segment.startTime &&
      previous.left === segment.left &&
      previous.width === segment.width;
    if (canMerge) {
      previous.endTime = segment.endTime;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

// Marks which visual pieces should show text and rounded ends
function labelAndConnectOpeningSegments(segments: OpeningSegment[]) {
  return segments.map((segment) => {
    const sameOpeningSegments = segments.filter((s) => s.opening.id === segment.opening.id);
    const firstSegment = sameOpeningSegments.reduce((best, current) =>
      timeToMinutes(current.startTime) < timeToMinutes(best.startTime) ? current : best
    );
    const lastSegment = sameOpeningSegments.reduce((best, current) =>
      timeToMinutes(current.endTime) > timeToMinutes(best.endTime) ? current : best
    );
    const labelSegment = sameOpeningSegments.reduce((best, current) => {
      const bestDuration = timeToMinutes(best.endTime) - timeToMinutes(best.startTime);
      const currentDuration = timeToMinutes(current.endTime) - timeToMinutes(current.startTime);
      if (current.widthPercent > best.widthPercent) {
        return current;
      }
      if (current.widthPercent === best.widthPercent && currentDuration > bestDuration) {
        return current;
      }
      return best;
    });
    return {
      ...segment,
      showLabel:
        segment.startTime === labelSegment.startTime &&
        segment.endTime === labelSegment.endTime &&
        segment.left === labelSegment.left &&
        segment.width === labelSegment.width,
      isFirstPiece:
        segment.startTime === firstSegment.startTime &&
        segment.left === firstSegment.left &&
        segment.width === firstSegment.width,
      isLastPiece:
        segment.endTime === lastSegment.endTime &&
        segment.left === lastSegment.left &&
        segment.width === lastSegment.width,
    };
  });
}

// Returns the active sort arrow for a table column
function getSortIndicator(current: SortField, direction: "asc" | "desc", column: SortField) {
  if (current !== column) return "";
  return direction === "asc" ? "↑" : "↓";
}

export default App;