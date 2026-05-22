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
  - Waitlist view shows sortable waitlisted patients.
  - Corner action button changes based on the active page.
*/

type WaitlistStatus = "WAITLISTED" | "SCHEDULED" | "REMOVED";
type DayCode = "M" | "Tu" | "W" | "Th" | "F";
type ViewMode = "CALENDAR" | "WAITLIST" | "ACTION";
type ActionMode = "OPENING" | "WAITLIST_ENTRY";

type SortField = "dateAdded" | "name" | "provider" | "tier" | "status"; // Maybe edit

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

// Opeing object
type Opening = {
  id: number;
  provider: string;
  date: string;
  day: DayCode;
  startTime: string;
  endTime: string;
};

// Providers
const providers: Provider[] = [
  { name: "Provider A", color: "#5877ff" },
  { name: "Provider B", color: "#ffe66d" },
];

// Calander
const dayLabels: { code: DayCode; label: string }[] = [
  { code: "M", label: "Mon" },
  { code: "Tu", label: "Tue" },
  { code: "W", label: "Wed" },
  { code: "Th", label: "Thu" },
  { code: "F", label: "Fri" },
];
const timeSlots = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
];

function App() {
  // Main screen
  const [activeView, setActiveView] = useState<ViewMode>("CALENDAR");
  // Manually add/remove
  const [actionMode, setActionMode] = useState<ActionMode>("OPENING");
  // Calander week
  const [weekStartDate, setWeekStartDate] = useState<string>("2026-05-25");
  // Openings (on calender)
  const [selectedOpeningId, setSelectedOpeningId] = useState<number | null>(1);
  // Sort waitlist
  const [sortField, setSortField] = useState<SortField>("dateAdded");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Temp waitlist entries
  const [entries, setEntries] = useState<WaitlistEntry[]>([
    {
      id: 1,
      dateAdded: "2026-05-22",
      firstName: "John",
      lastName: "Smith",
      provider: "Provider A",
      tier: 1,
      reason: "Urgent follow-up",
      availableDays: ["M", "W", "F"],
      availableTimes: ["14:00-16:00"],
      status: "WAITLISTED",
    },
    {
      id: 2,
      dateAdded: "2026-05-20",
      firstName: "Mary",
      lastName: "Adams",
      provider: "Provider A",
      tier: 2,
      reason: "Medication review",
      availableDays: ["Tu", "Th"],
      availableTimes: ["09:00-12:00", "14:00-17:00"],
      status: "WAITLISTED",
    },
    {
      id: 3,
      dateAdded: "2026-05-18",
      firstName: "Alex",
      lastName: "Rivera",
      provider: "Provider B",
      tier: 1,
      reason: "Post-op concern",
      availableDays: ["Th"],
      availableTimes: ["08:00-10:00"],
      status: "WAITLISTED",
    },
    {
      id: 4,
      dateAdded: "2026-05-16",
      firstName: "Sarah",
      lastName: "Miller",
      provider: "Provider B",
      tier: 3,
      reason: "Routine check",
      availableDays: ["Th", "F"],
      availableTimes: ["13:00-16:00"],
      status: "WAITLISTED",
    },
    {
      id: 5,
      dateAdded: "2026-05-15",
      firstName: "Daniel",
      lastName: "Clark",
      provider: "Provider A",
      tier: 1,
      reason: "Flexible urgent visit",
      availableDays: [],
      availableTimes: [],
      status: "WAITLISTED",
    },
  ]);

  // Temp opening entries
  const [openings] = useState<Opening[]>([
    {
      id: 1,
      provider: "Provider A",
      date: "2026-05-26",
      day: "Tu",
      startTime: "09:00",
      endTime: "13:00",
    },
    {
      id: 2,
      provider: "Provider B",
      date: "2026-05-28",
      day: "Th",
      startTime: "08:00",
      endTime: "10:00",
    },
    {
      id: 3,
      provider: "Provider B",
      date: "2026-05-28",
      day: "Th",
      startTime: "13:00",
      endTime: "16:00",
    },
  ]);



  // Builds calader
  const weekDates = useMemo(() => {
    const start = parseLocalDate(weekStartDate);
    return dayLabels.map((day, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        ...day,
        date,
        dateString: toDateInputValue(date),
      };
    });
  }, [weekStartDate]);
  // Gets opening object
  const selectedOpening = openings.find((opening) => opening.id === selectedOpeningId) ?? null;

  /*
    Finds people eligible for the selected opening.
    Rules:
    - Must still be WAITLISTED.
    - Must match the provider.
    - Must be available on the opening day.
    - Must have an overlapping time range.
    - Tier 1 with no listed availability is treated as flexible urgent.
    - Results are sorted by tier first, then date added.
  */
  const eligibleEntries = useMemo(() => {
    if (!selectedOpening) return [];
    return entries
      .filter((entry) => entry.status === "WAITLISTED")
      .filter((entry) => entry.provider === selectedOpening.provider)
      .filter((entry) => isEntryAvailableForOpening(entry, selectedOpening))
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return (
          new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
        );
      });
  }, [entries, selectedOpening]);


  // Builds waitlist table
  const sortedWaitlistEntries = useMemo(() => {
    const waitlistedOnly = entries.filter(
      (entry) => entry.status === "WAITLISTED"
    );
    return [...waitlistedOnly].sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      if (sortField === "dateAdded") {
        return (
          (new Date(a.dateAdded).getTime() -
            new Date(b.dateAdded).getTime()) *
          direction
        );
      }
      if (sortField === "name") {
        return getFullName(a).localeCompare(getFullName(b)) * direction;
      }
      if (sortField === "provider") {
        return a.provider.localeCompare(b.provider) * direction;
      }
      if (sortField === "tier") {
        return (a.tier - b.tier) * direction;
      }
      return a.status.localeCompare(b.status) * direction;
    });
  }, [entries, sortField, sortDirection]);

  
  // Prev week
  function goToPreviousWeek() {
    setWeekStartDate((currentDate) => moveDateByDays(currentDate, -7));
    setSelectedOpeningId(null);
  }

  // Next week
  function goToNextWeek() {
    setWeekStartDate((currentDate) => moveDateByDays(currentDate, 7));
    setSelectedOpeningId(null);
  }

  // Mark as scheduled isntead of deleteing
  function markScheduled(id: number) {
    setEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.id === id ? { ...entry, status: "SCHEDULED" } : entry
      )
    );
  }

  // Marks entry as removed instead of deleting
  function removeEntry(id: number) {
    setEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.id === id ? { ...entry, status: "REMOVED" } : entry
      )
    );
  }

  // Sorts Waitlist table
  function handleSortChange(nextSortField: SortField) {
    if (nextSortField === sortField) {
      setSortDirection((currentDirection) =>
        currentDirection === "asc" ? "desc" : "asc"
      );
      return;
    }
    setSortField(nextSortField);
    setSortDirection("asc");
  }

  

  // Opens action pages
  function openActionPage() {
    if (activeView === "WAITLIST") {
      setActionMode("WAITLIST_ENTRY");
    } else {
      setActionMode("OPENING");
    }
    setActiveView("ACTION");
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <nav className="main-nav">
          <button
            className={
              activeView === "CALENDAR" ? "nav-button active" : "nav-button"
            }
            onClick={() => setActiveView("CALENDAR")}
          >
            Calendar
          </button>
          <button
            className={
              activeView === "WAITLIST" ? "nav-button active" : "nav-button"
            }
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
              {providers.map((provider) => (
                <div className="provider-key" key={provider.name}>
                  <span>{provider.name}</span>
                  <span
                    className="provider-color"
                    style={{ backgroundColor: provider.color }}
                  />
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
              {weekDates.map((day) => (
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
                    {openings
                      .filter((opening) => opening.date === day.dateString)
                      .map((opening) => {
                        const providerColor =
                          providers.find(
                            (provider) => provider.name === opening.provider
                          )?.color ?? "#999";
                        return (
                          <button
                            key={opening.id}
                            className={
                              selectedOpeningId === opening.id
                                ? "opening-block selected"
                                : "opening-block"
                            }
                            style={{
                              backgroundColor: providerColor,
                              top: `${getOpeningTop(opening.startTime)}%`,
                              height: `${getOpeningHeight(
                                opening.startTime,
                                opening.endTime
                              )}%`,
                            }}
                            onClick={() => setSelectedOpeningId(opening.id)}
                          >
                            <span>{opening.provider}</span>
                            <span>
                              {formatTime(opening.startTime)}-
                              {formatTime(opening.endTime)}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <aside className="eligible-panel">
            {selectedOpening ? (
              <>
                <div className="selected-opening-header">
                  <h2>{selectedOpening.provider}</h2>
                  <p>
                    {selectedOpening.day} ·{" "}
                    {formatDisplayDate(selectedOpening.date)}
                  </p>
                  <p>
                    Time Range: {formatTime(selectedOpening.startTime)}-
                    {formatTime(selectedOpening.endTime)}
                  </p>
                </div>
                <h3>Eligible Waitlist</h3>
                {eligibleEntries.length === 0 ? (
                  <p className="empty-message">
                    No eligible waitlist entries for this opening.
                  </p>
                ) : (
                  <div className="eligible-list">
                    {eligibleEntries.map((entry) => (
                      <article className="eligible-card" key={entry.id}>
                        <div>
                          <h4>{getFullName(entry)}</h4>
                          <p>Tier {entry.tier}</p>
                          <p>{entry.reason}</p>
                          <p>
                            Available:{" "}
                            {formatAvailability(
                              entry.availableDays,
                              entry.availableTimes
                            )}
                          </p>
                        </div>
                        <button onClick={() => markScheduled(entry.id)}>
                          Mark Scheduled
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="empty-message">
                Select a provider opening to see eligible people.
              </p>
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
                <button
                  className="table-sort-button"
                  onClick={() => handleSortChange("name")}
                >
                  Last Name, First Name {getSortIndicator(sortField, sortDirection, "name")}
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
                <button
                  className="table-sort-button"
                  onClick={() => handleSortChange("tier")}
                >
                  Tier {getSortIndicator(sortField, sortDirection, "tier")}
                </button>
              </th>
              <th>Reason</th>
              <th>Dates</th>
              <th>Times</th>
              <th>
                <button
                  className="table-sort-button"
                  onClick={() => handleSortChange("status")}
                >
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
                  <td>{entry.tier}</td>
                  <td>{entry.reason}</td>
                  <td>{entry.availableDays.join(", ") || "Any"}</td>
                  <td>{entry.availableTimes.join(", ") || "Any"}</td>
                  <td>{entry.status}</td>
                  <td>
                    <button onClick={() => markScheduled(entry.id)}>
                      Mark Scheduled
                    </button>
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
              <h1>Add/Remove Opening</h1>
              <p>
                Placeholder frontend screen. This will become the form for
                provider, date, start time, and end time.
              </p>
              <div className="opening-list">
                {openings.map((opening) => (
                  <article className="opening-list-card" key={opening.id}>
                    <strong>{opening.provider}</strong>
                    <span>{opening.date}</span>
                    <span>
                      {formatTime(opening.startTime)}-
                      {formatTime(opening.endTime)}
                    </span>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1>Add to Waitlist</h1>
              <p>
                Placeholder frontend screen. This will become the form for date
                added, patient name, provider, tier, reason, available dates, and
                available times.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}

// Display name
function getFullName(entry: WaitlistEntry) {
  return `${entry.lastName}, ${entry.firstName}`;
}

// Date
function parseLocalDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Future/past dates
function moveDateByDays(dateString: string, days: number) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}


function formatDisplayDate(dateString: string) {
  const date = parseLocalDate(dateString);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(time: string) {
  const [hourString, minute] = time.split(":");
  const hour = Number(hourString);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function parseTimeRange(range: string) {
  const [startTime, endTime] = range.split("-");
  return {
    start: timeToMinutes(startTime),
    end: timeToMinutes(endTime),
  };
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

// Is available
function isEntryAvailableForOpening(entry: WaitlistEntry, opening: Opening) {
  const hasFlexibleUrgentAvailability =
    entry.tier === 1 &&
    entry.availableDays.length === 0 &&
    entry.availableTimes.length === 0;
  if (hasFlexibleUrgentAvailability) {
    return true;
  }
  const dayMatches =
    entry.availableDays.length === 0 || entry.availableDays.includes(opening.day);
  if (!dayMatches) {
    return false;
  }
  if (entry.availableTimes.length === 0) {
    return true;
  }
  const openingStart = timeToMinutes(opening.startTime);
  const openingEnd = timeToMinutes(opening.endTime);
  return entry.availableTimes.some((range) => {
    const availableRange = parseTimeRange(range);
    return rangesOverlap(
      availableRange.start,
      availableRange.end,
      openingStart,
      openingEnd
    );
  });
}

// Calculates how far down a opening starts
function getOpeningTop(startTime: string) {
  const calendarStart = timeToMinutes("08:00");
  const calendarEnd = timeToMinutes("18:00");
  const openingStart = timeToMinutes(startTime);
  return ((openingStart - calendarStart) / (calendarEnd - calendarStart)) * 100;
}

// Gets height of block
function getOpeningHeight(startTime: string, endTime: string) {
  const calendarStart = timeToMinutes("08:00");
  const calendarEnd = timeToMinutes("18:00");
  const openingStart = timeToMinutes(startTime);
  const openingEnd = timeToMinutes(endTime);
  return ((openingEnd - openingStart) / (calendarEnd - calendarStart)) * 100;
}


function formatAvailability(days: DayCode[], times: string[]) {
  const dayText = days.length > 0 ? days.join(", ") : "Any day";
  const timeText = times.length > 0 ? times.join(", ") : "Any time";

  return `${dayText}; ${timeText}`;
}

function getSortIndicator(
  currentSortField: SortField,
  currentSortDirection: "asc" | "desc",
  column: SortField
) {
  if (currentSortField !== column) {
    return "";
  }
  return currentSortDirection === "asc" ? "↑" : "↓";
}

export default App;