import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import "./App.css";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────


type WaitlistStatus = "WAITLISTED" | "SCHEDULED" | "REMOVED";
type DayCode = "M" | "Tu" | "W" | "Th" | "F";
type ViewMode = "CALENDAR" | "WAITLIST";
type ActionMode = "OPENING" | "WAITLIST_ENTRY" | "EDIT_PROVIDERS";
type SortField = "dateAdded" | "name" | "provider" | "tier" | "status";
type WaitlistHistoryPanel = "ACTIVE" | "SCHEDULED" | "REMOVED";

type PendingRemoval =
  | { type: "ENTRY";            id: number; entryId?: never; title: string; message: string; confirmLabel: string }
  | { type: "OPENING";          id: number; entryId?: never; title: string; message: string; confirmLabel: string }
  | { type: "SCHEDULED_RECORD"; id: number; entryId: number; title: string; message: string; confirmLabel: string }
  | { type: "REMOVED_RECORD";   id: number; entryId: number; title: string; message: string; confirmLabel: string }
  | { type: "PROVIDER"; name: string; id?: never; entryId?: never; title: string; message: string; confirmLabel: string };

type WaitlistEntry = {
  id: number;
  dateAdded: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  availableDays: DayCode[];
  availableTimes: string[]; // "H:MM-H:MM"
  status: WaitlistStatus;
};

type TimeRangeDraft = {
  id: number;
  startTime: string;
  endTime: string;
};

type ScheduledRecord = {
  id: number;
  entryId: number;
  dateScheduled: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  status: "SCHEDULED";
  appointmentDate: string;
  appointmentDay: DayCode;
  startTime: string;
  endTime: string;
};

type RemovedRecord = {
  id: number;
  entryId: number;
  dateRemoved: string;
  dateAdded: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  status: "REMOVED";
};

type ImportPreviewStatus = "READY" | "WARNING" | "ERROR";

type ImportPreviewRow = {
  id: number;
  rowNumber: number;
  dateAdded: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  availableDays: DayCode[];
  availableTimes: string[];
  status: ImportPreviewStatus;
  messages: string[];
  raw: {
    dateAdded: string;
    name: string;
    provider: string;
    tier: string;
    dates: string;
    times: string;
  };
};

// For schedule start/end dropdowns
type ScheduleSelection = {
  startTime: string;
  endTime: string;
};

type TimeWindow = {
  start: number; // minutes from midnight
  end: number;
};

type Provider = {
  name: string;
  color: string; // Hex color
};

type Opening = {
  id: number;
  provider: string;
  date: string;      // YYYY-MM-DD
  day: DayCode;
  startTime: string; // Stored as "H:MM" 
  endTime: string;
};

// One visible slice of an opening after collision-splitting for calendar rendering
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

// EditingOpening carries _original so we can revert; EditingProvider carries _originalName
// so we can update references across openings/entries when a provider is renamed
type EditingOpening  = Opening  & { _original?: Opening };
type EditingEntry  = WaitlistEntry;
type EditingProvider  = Provider & { _originalName?: string };

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DAY_LABELS: { code: DayCode; label: string }[] = [
  { code: "M",  label: "Mon" },
  { code: "Tu", label: "Tue" },
  { code: "W",  label: "Wed" },
  { code: "Th", label: "Thu" },
  { code: "F",  label: "Fri" },
];

// Calendar renders 8:00 AM – 6:00 PM
const CAL_START_MIN = 8 * 60; 
const CAL_END_MIN   = 18 * 60; 
const CAL_SPAN      = CAL_END_MIN - CAL_START_MIN; 

// Drag/resize snaps to 15 minute intervals
const SNAP = 15;

// Old openings and history records are purged after this many days
const RETENTION_DAYS = 14;

// Hourly labels 
const TIME_SLOT_LABELS = buildTimeOptions(CAL_START_MIN, CAL_END_MIN - 60, 60);

// All 15 minute marks used in dropdowns.
const ALL_TIME_OPTIONS = buildTimeOptions(CAL_START_MIN, CAL_END_MIN, SNAP);

// Default provider color for new or edited providers
const DEFAULT_PROVIDER_COLOR = "#5877ff";

// Used when an imported sheet references providers that do not exist yet.
const IMPORT_PROVIDER_COLORS = [
  "#5877ff", "#c9a227", "#6db870", "#d06060", "#9a77ff",
  "#4ca6a8", "#d47a3c", "#cc66aa", "#7898d8", "#7a9a54",
];

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  // View state ────────────────────────────────────────────────────────────
  const [activeView,           setActiveView]           = useState<ViewMode>("CALENDAR");
  const [waitlistHistoryPanel, setWaitlistHistoryPanel] = useState<WaitlistHistoryPanel>("ACTIVE");
  const [actionMode,           setActionMode]           = useState<ActionMode>("OPENING");
  const [isActionPageOpen,     setIsActionPageOpen]     = useState(false);

  // Calendar interaction state ────────────────────────────────────────────
  const [calendarLocked,    setCalendarLocked]    = useState(true);
  const [selectedOpeningId, setSelectedOpeningId] = useState<number | null>(1);
  const [hoveredOpeningId,  setHoveredOpeningId]  = useState<number | null>(null);
  const [weekStartDate,     setWeekStartDate]     = useState<string>(getCurrentWeekStartDate);

  // Edit / modal state ────────────────────────────────────────────────────
  const [editingOpening,  setEditingOpening]  = useState<EditingOpening  | null>(null);
  const [editingEntry,    setEditingEntry]    = useState<EditingEntry    | null>(null);
  const [editingProvider, setEditingProvider] = useState<EditingProvider | null>(null);
  const [pendingRemoval,  setPendingRemoval]  = useState<PendingRemoval  | null>(null);

  // Import / export modal state ───────────────────────────────────────────
  const [isImportExportModalOpen, setIsImportExportModalOpen] = useState(false);
  const [importPreviewRows,       setImportPreviewRows]       = useState<ImportPreviewRow[]>([]);
  const [importFileName,          setImportFileName]          = useState("");
  const [importError,             setImportError]             = useState("");
  const [isImportDragOver,        setIsImportDragOver]        = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // Core data ─────────────────────────────────────────────────────────────
  const [providers, setProviders] = useState<Provider[]>([]);

  const [entries, setEntries] = useState<WaitlistEntry[]>([]);

  const [openings, setOpenings] = useState<Opening[]>([]);

  const [scheduledRecords, setScheduledRecords] = useState<ScheduledRecord[]>([]);
  const [removedRecords,   setRemovedRecords]   = useState<RemovedRecord[]>([]);

  // Stores the user's current start/end selection per eligible entry on the calendar panel
  const [scheduleSelections, setScheduleSelections] = useState<Record<number, ScheduleSelection>>({});

  // "Add Opening" form state ───────────────────────────────────────────────
  const [openingProvider,   setOpeningProvider]   = useState("");
  const [openingDate,       setOpeningDate]       = useState(getDefaultOpeningDate);
  const [openingStartTime,  setOpeningStartTime]  = useState("8:00");
  const [openingEndTime,    setOpeningEndTime]    = useState("9:00");

  // "Add to Waitlist" form state ───────────────────────────────────────────
  const [waitlistDateAdded,        setWaitlistDateAdded]        = useState(getTodayDateInputValue);
  const [waitlistFirstName,        setWaitlistFirstName]        = useState("");
  const [waitlistLastName,         setWaitlistLastName]         = useState("");
  const [waitlistProvider,         setWaitlistProvider]         = useState("");
  const [waitlistTier,             setWaitlistTier]             = useState<1 | 2 | 3>(1);
  const [waitlistReason,           setWaitlistReason]           = useState(getTierReason(1));
  const [waitlistAvailableDays,    setWaitlistAvailableDays]    = useState<DayCode[]>([]);
  const [waitlistAvailableTimeRanges, setWaitlistAvailableTimeRanges] = useState<TimeRangeDraft[]>([]);

  // "Edit Providers" form state ────────────────────────────────────────────
  const [providerName,  setProviderName]  = useState("");
  const [providerColor, setProviderColor] = useState(DEFAULT_PROVIDER_COLOR);

  // Drag state ────────────────────────────────────────────────────────────
  type DragState = {
    openingId:    number;
    mode:         "move" | "resize-top" | "resize-bottom";
    startY:       number;
    origStartMin: number;
    origEndMin:   number;
    colHeightPx:  number;
  };
  const dragRef    = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────────────────────

  // Retention rules:
  // - Openings expire only when the opening date is at least RETENTION_DAYS in the past.
  // - Scheduled records expire only when the appointment date is at least RETENTION_DAYS in the past.
  // - Removed records expire when the removed date is at least RETENTION_DAYS in the past.
  // Entries whose scheduled/removed records expire are also removed from the backing entries array.
  useEffect(() => {
    const today = startOfLocalDay(new Date());

    const staleScheduledEntryIds = new Set(
      scheduledRecords
        .filter(r => isDateAtLeastRetentionDaysOld(r.appointmentDate, today))
        .map(r => r.entryId),
    );

    const staleRemovedEntryIds = new Set(
      removedRecords
        .filter(r => isDateAtLeastRetentionDaysOld(r.dateRemoved, today))
        .map(r => r.entryId),
    );

    setOpenings(prev =>
      filterWithoutStateChange(prev, o => !isDateAtLeastRetentionDaysOld(o.date, today)),
    );

    setScheduledRecords(prev =>
      filterWithoutStateChange(prev, r => !isDateAtLeastRetentionDaysOld(r.appointmentDate, today)),
    );

    setRemovedRecords(prev =>
      filterWithoutStateChange(prev, r => !isDateAtLeastRetentionDaysOld(r.dateRemoved, today)),
    );

    if (staleScheduledEntryIds.size > 0 || staleRemovedEntryIds.size > 0) {
      setEntries(prev =>
        filterWithoutStateChange(prev, e =>
          !(e.status === "SCHEDULED" && staleScheduledEntryIds.has(e.id)) &&
          !(e.status === "REMOVED"   && staleRemovedEntryIds.has(e.id)),
        ),
      );
    }
  }, [scheduledRecords, removedRecords]);


  // Keep provider dropdown state valid after providers are added, removed, imported, or renamed.
  useEffect(() => {
    setOpeningProvider(current =>
      providers.some(p => p.name === current) ? current : providers[0]?.name ?? "",
    );

    setWaitlistProvider(current =>
      providers.some(p => p.name === current) ? current : providers[0]?.name ?? "",
    );
  }, [providers]);

  // If the selected opening is deleted (by cleanup or the user), deselect it
  useEffect(() => {
    if (selectedOpeningId !== null && !openings.some(o => o.id === selectedOpeningId)) {
      setSelectedOpeningId(null);
    }
  }, [openings, selectedOpeningId]);

  // ─────────────────────────────────────────────────────────────────────────
  // DRAG HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();

    const dyMin  = ((e.clientY - d.startY) / d.colHeightPx) * CAL_SPAN;
    const minDur = 30; // minimum opening duration in minutes
    setOpenings(prev => prev.map(o => {
      if (o.id !== d.openingId) return o;
      let newStart = d.origStartMin;
      let newEnd   = d.origEndMin;
      if (d.mode === "move") {
        const dur = d.origEndMin - d.origStartMin;
        newStart = snapToInterval(d.origStartMin + dyMin, SNAP);
        newEnd   = newStart + dur;
        // Clamp so the block doesn't leave the calendar bounds.
        if (newStart < CAL_START_MIN) { newStart = CAL_START_MIN; newEnd = newStart + dur; }
        if (newEnd   > CAL_END_MIN)   { newEnd   = CAL_END_MIN;   newStart = newEnd - dur; }
      } else if (d.mode === "resize-top") {
        newStart = snapToInterval(d.origStartMin + dyMin, SNAP);
        newStart = Math.max(CAL_START_MIN, Math.min(newStart, d.origEndMin - minDur));
      } else {
        newEnd = snapToInterval(d.origEndMin + dyMin, SNAP);
        newEnd = Math.min(CAL_END_MIN, Math.max(newEnd, d.origStartMin + minDur));
      }
      return { ...o, startTime: minutesToTimeString(newStart), endTime: minutesToTimeString(newEnd) };
    }));
  }, []);

  const handlePointerUp = useCallback(() => {
    const finishedDragId = dragRef.current?.openingId ?? null;
    if (finishedDragId !== null) {
      // After a drag, merge any now-overlapping openings from the same provider.
      setOpenings(prev => mergeSameProviderOpenings(prev, finishedDragId));
      setSelectedOpeningId(finishedDragId);
    }
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

  // ─────────────────────────────────────────────────────────────────────────
  // SORT STATE
  // ─────────────────────────────────────────────────────────────────────────

  const [sortField,     setSortField]     = useState<SortField>("dateAdded");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  function handleSortChange(next: SortField) {
    if (next === sortField) {
      setSortDirection(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(next);
      setSortDirection("asc");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DERIVED / MEMOIZED DATA
  // ─────────────────────────────────────────────────────────────────────────

  // Build one date object per weekday for the currently-displayed week
  const weekDates = useMemo(() => {
    const start = parseLocalDate(weekStartDate);
    return DAY_LABELS.map((day, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return { ...day, date, dateString: toDateInputValue(date) };
    });
  }, [weekStartDate]);

  const selectedOpening = openings.find(o => o.id === selectedOpeningId) ?? null;

  // Eligible entries for the selected opening: same provider, waitlisted, availability overlap
  const eligibleEntries = useMemo(() => {
    if (!selectedOpening) return [];
    return entries
      .filter(e =>
        e.status === "WAITLISTED" &&
        e.provider === selectedOpening.provider &&
        isEntryAvailableForOpening(e, selectedOpening),
      )
      // Sort by tier first, then by how long they've been waiting (oldest first)
      .sort((a, b) => a.tier !== b.tier
        ? a.tier - b.tier
        : new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime(),
      );
  }, [entries, selectedOpening]);

  const waitlistedCount = entries.filter(e => e.status === "WAITLISTED").length;
  const scheduledCount  = scheduledRecords.length;

  const importValidRows   = importPreviewRows.filter(row => row.status !== "ERROR");
  const importErrorRows   = importPreviewRows.filter(row => row.status === "ERROR");
  const importWarningRows = importPreviewRows.filter(row => row.status === "WARNING");

  const todayDateString = getTodayDateInputValue();

  const upcomingScheduledRecords = [...scheduledRecords]
    .filter(r => !isPastDate(r.appointmentDate, todayDateString))
    .sort(compareScheduledRecordsByAppointment);

  const pastScheduledRecords = [...scheduledRecords]
    .filter(r => isPastDate(r.appointmentDate, todayDateString))
    .sort((a, b) => compareScheduledRecordsByAppointment(b, a));

  const sortedWaitlistEntries = useMemo(() => {
    const waitlistedOnly = entries.filter(e => e.status === "WAITLISTED");
    return [...waitlistedOnly].sort((a, b) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortField) {
        case "dateAdded": return (new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()) * dir;
        case "name":      return getFullName(a).localeCompare(getFullName(b)) * dir;
        case "provider":  return a.provider.localeCompare(b.provider) * dir;
        case "tier":      return (a.tier - b.tier) * dir;
        default:          return a.status.localeCompare(b.status) * dir; // "status" sort field
      }
    });
  }, [entries, sortField, sortDirection]);

  // Derived label for the opening duration preview in the Add Opening form
  const openingDurationLabel = (() => {
    const diff = (timeToMinutes(openingEndTime) - timeToMinutes(openingStartTime)) / 60;
    if (diff <= 0)     return "—";
    if (diff === 1)    return "1 hr";
    if (diff % 1 === 0) return `${diff} hrs`;
    return `${diff.toFixed(1)} hrs`;
  })();

  const waitlistInitials = (waitlistFirstName[0] ?? "") + (waitlistLastName[0] ?? "");

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — NAVIGATION & ACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  function goToPreviousWeek() { setWeekStartDate(d => moveDateByDays(d, -7)); setSelectedOpeningId(null); }
  function goToNextWeek()     { setWeekStartDate(d => moveDateByDays(d,  7)); setSelectedOpeningId(null); }

  function openActionPage() {
    setActionMode(activeView === "WAITLIST" ? "WAITLIST_ENTRY" : "OPENING");
    setIsActionPageOpen(true);
  }

  function clearImportPreview() {
    setImportPreviewRows([]);
    setImportFileName("");
    setImportError("");
    setIsImportDragOver(false);
    if (importFileInputRef.current) importFileInputRef.current.value = "";
  }

  function closeImportExportModal() {
    setIsImportExportModalOpen(false);
    clearImportPreview();
  }

  function handleImportFile(file: File | null) {
    if (!file) return;
    setImportError("");
    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = event.target?.result;
        if (!data) throw new Error("Unable to read the selected file.");
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("The workbook does not contain a sheet.");

        const parsedRows = parseImportedWaitlistSheet(workbook.Sheets[firstSheetName]);
        const annotatedRows = annotateImportedProviders(parsedRows, providers);
        setImportPreviewRows(annotatedRows);
        if (annotatedRows.length === 0) setImportError("No waitlist rows were found in the first sheet.");
      } catch (error) {
        setImportPreviewRows([]);
        setImportError(error instanceof Error ? error.message : "The file could not be imported.");
      }
    };
    reader.onerror = () => setImportError("The file could not be read.");
    reader.readAsArrayBuffer(file);
  }

  function confirmImportRows() {
    const rowsToImport = importPreviewRows.filter(row => row.status !== "ERROR");
    if (rowsToImport.length === 0) return;

    const providerNameByKey = new Map(providers.map(p => [p.name.trim().toLowerCase(), p.name]));
    const providersToAdd: Provider[] = [];

    for (const row of rowsToImport) {
      const providerName = row.provider.trim();
      const key = providerName.toLowerCase();
      if (!key || providerNameByKey.has(key)) continue;
      providerNameByKey.set(key, providerName);
      providersToAdd.push({
        name:  providerName,
        color: IMPORT_PROVIDER_COLORS[(providers.length + providersToAdd.length) % IMPORT_PROVIDER_COLORS.length],
      });
    }

    let nextEntryId = getNextId(entries);
    const importedEntries: WaitlistEntry[] = rowsToImport.map(row => {
      const providerKey = row.provider.trim().toLowerCase();
      return {
        id:             nextEntryId++,
        dateAdded:      row.dateAdded,
        firstName:      row.firstName,
        lastName:       row.lastName,
        provider:       providerNameByKey.get(providerKey) ?? row.provider.trim(),
        tier:           row.tier,
        reason:         getTierReason(row.tier),
        availableDays:  row.availableDays,
        availableTimes: row.availableTimes,
        status:         "WAITLISTED",
      };
    });

    if (providersToAdd.length > 0) setProviders(prev => [...prev, ...providersToAdd]);
    setEntries(prev => [...prev, ...importedEntries]);
    setActiveView("WAITLIST");
    setWaitlistHistoryPanel("ACTIVE");
    closeImportExportModal();
  }

  function exportWaitlistToExcel() {
    const rows = entries
      .filter(entry => entry.status === "WAITLISTED")
      .map(entry => ({
        "Date added": formatDateForExport(entry.dateAdded),
        Name:         formatPersonName(entry.firstName, entry.lastName),
        Provider:     entry.provider,
        Tier:         entry.tier,
        Reason:       getTierReason(entry.tier),
        Dates:        entry.availableDays.join(","),
        Times:        formatAvailableTimesForExport(entry.availableTimes),
      }));

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ["Date added", "Name", "Provider", "Tier", "Reason", "Dates", "Times"],
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Waitlist");
    XLSX.writeFile(workbook, `waitlist-export-${getTodayDateInputValue()}.xlsx`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — SCHEDULING
  // ─────────────────────────────────────────────────────────────────────────

  function scheduleEntryForSelectedOpening(
    entryId: number,
    appointmentStartTime: string,
    appointmentEndTime: string,
  ) {
    if (!selectedOpening) return;
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    const apptStart    = timeToMinutes(appointmentStartTime);
    const apptEnd      = timeToMinutes(appointmentEndTime);
    const openingStart = timeToMinutes(selectedOpening.startTime);
    const openingEnd   = timeToMinutes(selectedOpening.endTime);

    // Guard: appointment must be at least 1 hour and fully within the opening
    if (apptEnd - apptStart < 60)                                     return;
    if (apptStart < openingStart || apptEnd > openingEnd)             return;
    if (!getEligibleScheduleWindows(entry, selectedOpening).some(
      w => apptStart >= w.start && apptEnd <= w.end)
    )                                                                  return;

    setScheduledRecords(prev => [
      {
        id:              getNextId(prev),
        entryId:         entry.id,
        dateScheduled:   toDateInputValue(new Date()),
        firstName:       entry.firstName,
        lastName:        entry.lastName,
        provider:        entry.provider,
        tier:            entry.tier,
        reason:          entry.reason,
        status:          "SCHEDULED",
        appointmentDate: selectedOpening.date,
        appointmentDay:  selectedOpening.day,
        startTime:       appointmentStartTime,
        endTime:         appointmentEndTime,
      },
      ...prev,
    ]);

    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, status: "SCHEDULED" } : e));
    setOpenings(prev => splitOpeningForAppointment(prev, selectedOpening.id, appointmentStartTime, appointmentEndTime));

    // Clear the stored selection for this entry and deselect the opening
    setScheduleSelections(prev => {
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
    setSelectedOpeningId(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — ADD FORMS
  // ─────────────────────────────────────────────────────────────────────────

  function addOpening() {
    if (!openingProvider || !openingDate || !openingStartTime || !openingEndTime) return;
    if (timeToMinutes(openingEndTime) <= timeToMinutes(openingStartTime)) return;
    // Weekends are outside the calendar's M–F range; warn and abort
    const dayCode = getDayCodeFromDate(openingDate);
    if (!dayCode) {
      alert("Openings can only be added on weekdays (Mon–Fri).");
      return;
    }

    const nextOpening: Opening = {
      id:        getNextId(openings),
      provider:  openingProvider,
      date:      openingDate,
      day:       dayCode,
      startTime: openingStartTime,
      endTime:   openingEndTime,
    };

    // Merge immediately in case it overlaps an existing opening from the same provider
    setOpenings(prev => mergeSameProviderOpenings([...prev, nextOpening], nextOpening.id));
    setSelectedOpeningId(nextOpening.id);
  }

  function addProvider() {
    const cleanName = providerName.trim();
    if (!cleanName) return;
    if (providers.some(p => p.name.toLowerCase() === cleanName.toLowerCase())) return;
    setProviders(prev => [...prev, { name: cleanName, color: providerColor }]);
    setProviderName("");
    setProviderColor(DEFAULT_PROVIDER_COLOR);
  }

  function addWaitlistEntry() {
    const firstName = waitlistFirstName.trim();
    const lastName  = waitlistLastName.trim();
    const reason    = waitlistReason.trim();
    if (!waitlistDateAdded || !firstName || !lastName || !waitlistProvider || !reason) return;

    const nextEntry: WaitlistEntry = {
      id:            getNextId(entries),
      dateAdded:     waitlistDateAdded,
      firstName,
      lastName,
      provider:      waitlistProvider,
      tier:          waitlistTier,
      reason,
      availableDays:  waitlistAvailableDays,
      availableTimes: serializeTimeRangeDrafts(waitlistAvailableTimeRanges),
      status:         "WAITLISTED",
    };

    setEntries(prev => [...prev, nextEntry]);
    resetWaitlistForm();
    setActiveView("WAITLIST");
    setIsActionPageOpen(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — EDIT SAVES
  // ─────────────────────────────────────────────────────────────────────────

  function saveEditingOpening() {
    if (!editingOpening) return;
    if (timeToMinutes(editingOpening.endTime) <= timeToMinutes(editingOpening.startTime)) return;
    setOpenings(prev =>
      mergeSameProviderOpenings(
        prev.map(o => o.id === editingOpening.id
          ? { ...editingOpening, day: getDayCodeFromDate(editingOpening.date) ?? editingOpening.day }
          : o,
        ),
        editingOpening.id,
      ),
    );
    setSelectedOpeningId(editingOpening.id);
    setEditingOpening(null);
  }

  function saveEditingEntry() {
    if (!editingEntry) return;
    setEntries(prev => prev.map(e => e.id === editingEntry.id ? editingEntry : e));
    setEditingEntry(null);
  }

  function saveEditingProvider() {
    if (!editingProvider) return;
    const oldName = editingProvider._originalName ?? editingProvider.name;
    const newName = editingProvider.name.trim();
    if (!newName) return;

    setProviders(prev => prev.map(p => p.name === oldName ? { name: newName, color: editingProvider.color } : p));

    // If the provider was renamed, update all references across openings and entries
    if (oldName !== newName) {
      setOpenings(prev => prev.map(o => o.provider === oldName ? { ...o, provider: newName } : o));
      setEntries(prev  => prev.map(e => e.provider === oldName ? { ...e, provider: newName } : e));
    }
    setEditingProvider(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 12: MUTATIONS — REMOVALS
  // ─────────────────────────────────────────────────────────────────────────

  // Each requestRemove* function populates the confirmation modal.
  function requestRemoveEntry(entry: WaitlistEntry) {
    setPendingRemoval({
      type:         "ENTRY",
      id:           entry.id,
      title:        "Remove waitlist entry?",
      message:      `This will remove ${getFullName(entry)} from the active waitlist.`,
      confirmLabel: "Remove Entry",
    });
  }

  function requestRemoveOpening(opening: Opening) {
    setPendingRemoval({
      type:         "OPENING",
      id:           opening.id,
      title:        "Remove opening?",
      message:      `This will delete the ${opening.provider} opening on ${formatDisplayDate(opening.date)} from ${formatTimeRange(opening.startTime, opening.endTime)}.`,
      confirmLabel: "Remove Opening",
    });
  }

  function requestDeleteScheduledRecord(record: ScheduledRecord) {
    setPendingRemoval({
      type:         "SCHEDULED_RECORD",
      id:           record.id,
      entryId:      record.entryId,
      title:        "Delete scheduled record?",
      message:      `This will permanently delete the scheduled record for ${formatPersonName(record.firstName, record.lastName)}.`,
      confirmLabel: "Delete Record",
    });
  }

  function requestDeleteRemovedRecord(record: RemovedRecord) {
    setPendingRemoval({
      type:         "REMOVED_RECORD",
      id:           record.id,
      entryId:      record.entryId,
      title:        "Delete removed record?",
      message:      `This will permanently delete the removed record for ${formatPersonName(record.firstName, record.lastName)}.`,
      confirmLabel: "Delete Record",
    });
  }

  function requestRemoveProvider(provider: Provider) {
    setPendingRemoval({
      type:         "PROVIDER",
      name:         provider.name,
      title:        "Remove provider?",
      message:      `This will remove ${provider.name} and delete all of their current openings.`,
      confirmLabel: "Remove Provider",
    });
  }

  function confirmPendingRemoval() {
    if (!pendingRemoval) return;

    switch (pendingRemoval.type) {
      case "ENTRY": {
        const removedEntry = entries.find(e => e.id === pendingRemoval.id);
        if (removedEntry) {
          setRemovedRecords(prev => [{
            id:          getNextId(prev),
            entryId:     removedEntry.id,
            dateRemoved: toDateInputValue(new Date()),
            dateAdded:   removedEntry.dateAdded,
            firstName:   removedEntry.firstName,
            lastName:    removedEntry.lastName,
            provider:    removedEntry.provider,
            tier:        removedEntry.tier,
            reason:      removedEntry.reason,
            status:      "REMOVED",
          }, ...prev]);
        }
        setEntries(prev => prev.map(e => e.id === pendingRemoval.id ? { ...e, status: "REMOVED" } : e));
        break;
      }
      case "OPENING": {
        setOpenings(prev => prev.filter(o => o.id !== pendingRemoval.id));
        if (selectedOpeningId === pendingRemoval.id) setSelectedOpeningId(null);
        break;
      }
      case "SCHEDULED_RECORD": {
        // Deleting a scheduled record also removes the underlying entry entirely.
        setScheduledRecords(prev => prev.filter(r => r.id !== pendingRemoval.id));
        setEntries(prev => prev.filter(e => e.id !== pendingRemoval.entryId));
        break;
      }
      case "REMOVED_RECORD": {
        setRemovedRecords(prev => prev.filter(r => r.id !== pendingRemoval.id));
        setEntries(prev => prev.filter(e => e.id !== pendingRemoval.entryId));
        break;
      }
      case "PROVIDER": {
        const removedName = pendingRemoval.name;
        const fallback    = providers.find(p => p.name !== removedName)?.name ?? "";
        setProviders(prev => prev.filter(p => p.name !== removedName));
        setOpenings(prev  => prev.filter(o => o.provider !== removedName));
        // If the removed provider was selected in either form, fall back to the first remaining.
        if (openingProvider  === removedName) setOpeningProvider(fallback);
        if (waitlistProvider === removedName) setWaitlistProvider(fallback);
        break;
      }
    }

    setPendingRemoval(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 13: MUTATIONS — AVAILABILITY / TIME RANGE FORM HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  function toggleWaitlistAvailableDay(day: DayCode) {
    setWaitlistAvailableDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day],
    );
  }

  function addWaitlistAvailableTimeRange() {
    setWaitlistAvailableTimeRanges(prev => [
      ...prev,
      { id: getNextTimeRangeId(prev), startTime: "9:00", endTime: "10:00" },
    ]);
  }

  function updateWaitlistAvailableTimeRange(id: number, field: "startTime" | "endTime", value: string) {
    setWaitlistAvailableTimeRanges(prev =>
      prev.map(r => r.id === id ? normalizeDraftTimeRange({ ...r, [field]: value }, field) : r),
    );
  }

  function removeWaitlistAvailableTimeRange(id: number) {
    setWaitlistAvailableTimeRanges(prev => prev.filter(r => r.id !== id));
  }

  // Mirror of the above for the edit-entry modal
  function addEditingEntryTimeRange() {
    if (!editingEntry) return;
    setEditingEntry({ ...editingEntry, availableTimes: [...editingEntry.availableTimes, "9:00-10:00"] });
  }

  function updateEditingEntryTimeRange(index: number, field: "startTime" | "endTime", value: string) {
    if (!editingEntry) return;
    const ranges = editingEntry.availableTimes.map(rangeToDraft);
    ranges[index] = normalizeDraftTimeRange({ ...ranges[index], [field]: value }, field);
    setEditingEntry({ ...editingEntry, availableTimes: serializeTimeRangeDrafts(ranges) });
  }

  function removeEditingEntryTimeRange(index: number) {
    if (!editingEntry) return;
    setEditingEntry({
      ...editingEntry,
      availableTimes: editingEntry.availableTimes.filter((_, i) => i !== index),
    });
  }

  function updateScheduleSelection(
    entryId: number,
    field: "startTime" | "endTime",
    value: string,
    entry: WaitlistEntry,
    opening: Opening,
  ) {
    const current = getResolvedScheduleSelection(entry, opening, scheduleSelections[entryId]);
    const windows = getEligibleScheduleWindows(entry, opening);
    const next    = normalizeScheduleSelection({ ...current, [field]: value }, field, windows);
    setScheduleSelections(prev => ({ ...prev, [entryId]: next }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FORM RESET
  // ─────────────────────────────────────────────────────────────────────────

  function resetWaitlistForm() {
    setWaitlistFirstName("");
    setWaitlistLastName("");
    setWaitlistTier(1);
    setWaitlistReason(getTierReason(1));
    setWaitlistAvailableDays([]);
    setWaitlistAvailableTimeRanges([]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /* Shared table for both "Scheduled" and "Past Scheduled" sections. */
  function renderScheduledRecordsTable(records: ScheduledRecord[]) {
    return (
      <table>
        <thead>
          <tr>
            <th>Scheduled On</th>
            <th>Name</th>
            <th>Provider</th>
            <th>Tier</th>
            <th>Status</th>
            <th>Appointment Date</th>
            <th>Time</th>
            <th>Reason</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map(record => (
            <tr key={record.id}>
              <td>{record.dateScheduled}</td>
              <td>{formatPersonName(record.firstName, record.lastName)}</td>
              <td>{record.provider}</td>
              <td><span className={`tier-badge tier-${record.tier}`}>Tier {record.tier}</span></td>
              <td>{record.status}</td>
              <td>{record.appointmentDay} · {formatDisplayDate(record.appointmentDate)}</td>
              <td>{formatTimeRange(record.startTime, record.endTime)}</td>
              <td>{record.reason}</td>
              <td>
                <button className="remove-button" onClick={() => requestDeleteScheduledRecord(record)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const cornerActionLabel = activeView === "WAITLIST" ? "+ Add to Waitlist" : "+ Add Opening";

  return (
    <main className="app-shell">

      {/* Top navigation bar */}
      <header className="top-bar">
        <nav className="main-nav">
          <button
            className={activeView === "CALENDAR" ? "nav-button active" : "nav-button"}
            onClick={() => { setActiveView("CALENDAR"); setIsActionPageOpen(false); }}
          >
            Calendar
          </button>
          <button
            className={activeView === "WAITLIST" ? "nav-button active" : "nav-button"}
            onClick={() => { setActiveView("WAITLIST"); setIsActionPageOpen(false); }}
          >
            Waitlist <span className="nav-count">{waitlistedCount}</span>
          </button>
        </nav>
        <div className="top-actions">
          <button className="corner-action-button" onClick={() => setIsImportExportModalOpen(true)}>
            Import/Export
          </button>
          <button className="corner-action-button" onClick={openActionPage}>
            {cornerActionLabel}
          </button>
        </div>
      </header>

      {/* ── CALENDAR VIEW ─────────────────────────────────────────────────── */}
      {!isActionPageOpen && activeView === "CALENDAR" && (
        <section className="calendar-page">

          {/* Legend + lock panel */}
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

            <h3>Lock Calendar</h3>
            <div className="lock-section">
              <button
                className={`lock-button ${calendarLocked ? "locked" : "unlocked"}`}
                onClick={() => setCalendarLocked(l => !l)}
                title={calendarLocked ? "Unlock to drag openings" : "Lock to prevent accidental moves"}
              >
                <span className="lock-icon">{calendarLocked ? "🔒" : "🔓"}</span>
                <span className="lock-label">{calendarLocked ? "Locked" : "Unlocked"}</span>
              </button>
              {!calendarLocked && <p className="lock-hint">Drag openings to move or resize</p>}
            </div>

            <button
              className="secondary-button"
              onClick={() => { setActionMode("EDIT_PROVIDERS"); setIsActionPageOpen(true); }}
            >
              Edit Providers
            </button>
          </aside>

          {/* Week grid */}
          <section className="calendar-panel">
            <div className="week-controls">
              <button className="arrow-button" onClick={goToPreviousWeek}>←</button>
              <h1>Week of {formatDisplayDate(weekStartDate)}</h1>
              <button className="arrow-button" onClick={goToNextWeek}>→</button>
            </div>

            <div className="calendar-grid">
              {weekDates.map(day => {
                const dayOpenings    = openings.filter(o => o.date === day.dateString);
                const openingSegments = buildOpeningSegments(dayOpenings);

                return (
                  <div className="day-column" key={day.dateString}>
                    <div className="day-header">
                      <span>{day.label}</span>
                      <strong>{day.date.getDate()}</strong>
                    </div>

                    <div className="day-body">
                      {/* Hourly time labels */}
                      {TIME_SLOT_LABELS.map(time => (
                        <div className="time-row" key={time}>
                          <span>{formatDisplayTime(time)}</span>
                        </div>
                      ))}

                      {/* Opening blocks */}
                      {openingSegments.map(segment => {
                        const color     = providers.find(p => p.name === segment.opening.provider)?.color ?? "#999";
                        const isDragging = draggingId === segment.opening.id;
                        // Always read live opening data so dragging re-positions in real time.
                        const opening   = openings.find(o => o.id === segment.opening.id) ?? segment.opening;

                        return (
                          <div
                            key={`${segment.opening.id}-${segment.startTime}-${segment.index}`}
                            className={[
                              "opening-block",
                              selectedOpeningId === segment.opening.id ? "selected"        : "",
                              hoveredOpeningId  === segment.opening.id ? "opening-hovered" : "",
                              segment.isFirstPiece ? "first-piece" : "",
                              segment.isLastPiece  ? "last-piece"  : "",
                              isDragging           ? "is-dragging" : "",
                              calendarLocked       ? "is-locked"   : "is-draggable",
                            ].join(" ")}
                            style={{
                              backgroundColor: color,
                              top:    isDragging ? `${getOpeningTopPct(opening.startTime)}%`             : `${getOpeningTopPct(segment.startTime)}%`,
                              height: isDragging ? `${getOpeningHeightPct(opening.startTime, opening.endTime)}%` : `${getOpeningHeightPct(segment.startTime, segment.endTime)}%`,
                              left:   segment.left,
                              width:  segment.width,
                              right:  "auto",
                            }}
                            onClick={() => { if (!isDragging) setSelectedOpeningId(segment.opening.id); }}
                            onMouseEnter={() => setHoveredOpeningId(segment.opening.id)}
                            onMouseLeave={() => setHoveredOpeningId(null)}
                          >
                            {/* Top resize handle (unlock mode only) */}
                            {!calendarLocked && segment.isFirstPiece && (
                              <div
                                className="resize-handle resize-top"
                                onPointerDown={e => {
                                  const col = e.currentTarget.closest(".day-body") as HTMLElement;
                                  startDrag(e, opening, "resize-top", col?.getBoundingClientRect().height ?? 600);
                                }}
                              />
                            )}

                            {/* Move handle + label */}
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
                                    {formatTimeRange(opening.startTime, opening.endTime)}
                                  </span>
                                </>
                              )}
                            </div>

                            {/* Inline edit button (visible on hover/select) */}
                            {segment.showLabel && (
                              <button
                                className="opening-edit-btn"
                                title="Edit opening"
                                onClick={e => { e.stopPropagation(); setEditingOpening({ ...opening, _original: opening }); }}
                              >
                                ✎
                              </button>
                            )}

                            {/* Bottom resize handle (unlock mode only) */}
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

          {/* Eligible patients panel */}
          <aside className="eligible-panel">
            {selectedOpening ? (
              <>
                <div className="selected-opening-header">
                  <div className="selected-opening-header-main">
                    <div className="selected-opening-details">
                      <h2>{selectedOpening.provider}</h2>
                      <p>{selectedOpening.day} · {formatDisplayDate(selectedOpening.date)}</p>
                      <p>{formatTimeRange(selectedOpening.startTime, selectedOpening.endTime)}</p>
                    </div>
                    <div className="selected-opening-actions">
                      <button
                        className="edit-btn-small"
                        onClick={() => setEditingOpening({ ...selectedOpening, _original: selectedOpening })}
                      >
                        Edit
                      </button>
                      <button className="remove-button" onClick={() => requestRemoveOpening(selectedOpening)}>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>

                <div className="eligible-list-header">
                  <h3>Eligible Waitlist</h3>
                  <span className="items-count">{eligibleEntries.length}</span>
                </div>

                {eligibleEntries.length === 0 ? (
                  <p className="empty-message">No eligible waitlist entries for this opening.</p>
                ) : (
                  <div className="eligible-list">
                    {eligibleEntries.map(entry => {
                      if (!selectedOpening) return null;
                      const windows      = getEligibleScheduleWindows(entry, selectedOpening);
                      const selection    = getResolvedScheduleSelection(entry, selectedOpening, scheduleSelections[entry.id]);
                      const startOptions = getScheduleStartOptions(windows);
                      const endOptions   = getScheduleEndOptions(windows, selection.startTime);

                      return (
                        <article className="eligible-card" key={entry.id}>
                          <div className="eligible-card-top">
                            <h4 className="eligible-patient-name">{getFullName(entry)}</h4>
                            <span className={`tier-badge tier-${entry.tier}`}>Tier {entry.tier}</span>
                          </div>
                          <div className="eligible-card-middle">
                            <p className="eligible-reason">{entry.reason}</p>
                            <button
                              className="eligible-schedule-button"
                              onClick={() => scheduleEntryForSelectedOpening(entry.id, selection.startTime, selection.endTime)}
                            >
                              Schedule
                            </button>
                          </div>
                          <div className="eligible-schedule-row">
                            <label>
                              <span>Start</span>
                              <select
                                value={selection.startTime}
                                onChange={e => updateScheduleSelection(entry.id, "startTime", e.target.value, entry, selectedOpening)}
                              >
                                {startOptions.map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                              </select>
                            </label>
                            <label>
                              <span>End</span>
                              <select
                                value={selection.endTime}
                                onChange={e => updateScheduleSelection(entry.id, "endTime", e.target.value, entry, selectedOpening)}
                              >
                                {endOptions.map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                              </select>
                            </label>
                          </div>
                          <p className="eligible-availability">
                            Available: {formatAvailability(entry.availableDays, entry.availableTimes)}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="empty-message">Select a provider opening to see eligible patients.</p>
            )}
          </aside>
        </section>
      )}

      {/* WAITLIST VIEW ─────────────────────────────────────────────────── */}
      {!isActionPageOpen && activeView === "WAITLIST" && (
        <section className="waitlist-page">
          <div className="page-header-row">
            <div className="waitlist-tab-row">
              <button
                className={waitlistHistoryPanel === "ACTIVE" ? "waitlist-tab active" : "waitlist-tab"}
                onClick={() => setWaitlistHistoryPanel("ACTIVE")}
              >
                Waitlist <span>{waitlistedCount}</span>
              </button>
              <button
                className={waitlistHistoryPanel === "SCHEDULED" ? "waitlist-tab active" : "waitlist-tab"}
                onClick={() => setWaitlistHistoryPanel("SCHEDULED")}
              >
                Scheduled <span>{scheduledCount}</span>
              </button>
              <button
                className={waitlistHistoryPanel === "REMOVED" ? "waitlist-tab active" : "waitlist-tab"}
                onClick={() => setWaitlistHistoryPanel("REMOVED")}
              >
                Removed
              </button>
            </div>
          </div>

          {/* Active waitlist table */}
          {waitlistHistoryPanel === "ACTIVE" && (
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
                    <td>{formatAvailableTimes(entry.availableTimes)}</td>
                    <td>{entry.status}</td>
                    <td>
                      <button className="edit-btn-small" onClick={() => setEditingEntry({ ...entry })}>Edit</button>
                      <button className="remove-button"  onClick={() => requestRemoveEntry(entry)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Scheduled history */}
          {waitlistHistoryPanel === "SCHEDULED" && (
            scheduledRecords.length === 0 ? (
              <p className="empty-message">No patients have been scheduled yet.</p>
            ) : (
              <div className="history-section-stack">
                <section className="history-section">
                  <div className="history-section-header">
                    <h2 className="history-section-title">Scheduled</h2>
                    <span className="items-count">{upcomingScheduledRecords.length}</span>
                  </div>
                  {upcomingScheduledRecords.length === 0
                    ? <p className="empty-message">No upcoming scheduled patients.</p>
                    : renderScheduledRecordsTable(upcomingScheduledRecords)
                  }
                </section>
                <section className="history-section">
                  <div className="history-section-header">
                    <h2 className="history-section-title">Past Scheduled</h2>
                    <span className="items-count">{pastScheduledRecords.length}</span>
                  </div>
                  {pastScheduledRecords.length === 0
                    ? <p className="empty-message">No appointments are past their appointment date.</p>
                    : renderScheduledRecordsTable(pastScheduledRecords)
                  }
                </section>
              </div>
            )
          )}

          {/* Removed history */}
          {waitlistHistoryPanel === "REMOVED" && (
            removedRecords.length === 0 ? (
              <p className="empty-message">No patients have been removed recently.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Removed On</th>
                    <th>Name</th>
                    <th>Provider</th>
                    <th>Tier</th>
                    <th>Status</th>
                    <th>Date Added</th>
                    <th>Reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {removedRecords.map(record => (
                    <tr key={record.id}>
                      <td>{record.dateRemoved}</td>
                      <td>{formatPersonName(record.firstName, record.lastName)}</td>
                      <td>{record.provider}</td>
                      <td><span className={`tier-badge tier-${record.tier}`}>Tier {record.tier}</span></td>
                      <td>{record.status}</td>
                      <td>{record.dateAdded}</td>
                      <td>{record.reason}</td>
                      <td>
                        <button className="remove-button" onClick={() => requestDeleteRemovedRecord(record)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </section>
      )}

      {/* ACTION PAGES ──────────────────────────────────────────────────── */}
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
                    {ALL_TIME_OPTIONS.slice(0, -1).map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                  </select>
                </label>
                <label className="field-label-block">
                  <span className="field-label-text">End time</span>
                  <select value={openingEndTime} onChange={e => setOpeningEndTime(e.target.value)}>
                    {ALL_TIME_OPTIONS
                      .filter(t => timeToMinutes(t) > timeToMinutes(openingStartTime))
                      .map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                  </select>
                </label>
                <div className="time-range-preview">
                  <span className="time-range-val">{formatDisplayTime(openingStartTime)}</span>
                  <span className="time-range-sep">→</span>
                  <span className="time-range-val">{formatDisplayTime(openingEndTime)}</span>
                  <span className="duration-badge">{openingDurationLabel}</span>
                </div>
              </div>
              <div className="form-submit-row">
                <button className="btn-secondary" onClick={() => setIsActionPageOpen(false)}>Cancel</button>
                <button className="btn-primary"   onClick={addOpening}>+ Add Opening</button>
              </div>

              <div className="form-divider" />

              <div className="items-section">
                <div className="items-section-header">
                  <div className="form-section-label" style={{ margin: 0, border: "none", padding: 0 }}>
                    Existing openings
                  </div>
                  <span className="items-count">
                    {openings.length} opening{openings.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {openings.length === 0 ? (
                  <p className="empty-message">No openings yet.</p>
                ) : openings.map(o => {
                  const color = providers.find(p => p.name === o.provider)?.color ?? "#999";
                  return (
                    <div className="item-row" key={o.id}>
                      <span className="item-dot"  style={{ backgroundColor: color }} />
                      <span className="item-name">{o.provider}</span>
                      <span className="item-meta">{formatDisplayDate(o.date)}</span>
                      <span className="item-meta">{formatTimeRange(o.startTime, o.endTime)}</span>
                      <button
                        className="item-edit-btn"
                        onClick={() => { setEditingOpening({ ...o, _original: o }); setIsActionPageOpen(false); }}
                      >
                        Edit
                      </button>
                      <button className="item-remove-btn" onClick={() => requestRemoveOpening(o)}>
                        Remove
                      </button>
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
                <div><h1 className="action-page-title">Edit Providers</h1></div>
                <button className="close-action-button" onClick={() => setIsActionPageOpen(false)}>×</button>
              </div>

              <div className="form-section-label">Add provider</div>
              <div className="form-row" style={{ marginBottom: 24, alignItems: "flex-end" }}>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">Provider name</span>
                  <input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="Name" />
                </label>
                <label className="field-label-block">
                  <span className="field-label-text">Calendar color</span>
                  <div className="color-field-row">
                    <span className="color-swatch" style={{ backgroundColor: providerColor }} />
                    <input type="color" value={providerColor} onChange={e => setProviderColor(e.target.value)} style={{ flex: 1 }} />
                  </div>
                </label>
                <button className="btn-primary" onClick={addProvider} style={{ alignSelf: "flex-end" }}>
                  + Add Provider
                </button>
              </div>
              {providerName.trim() && (
                <div className="name-preview-bar" style={{ marginBottom: 20 }}>
                  <span className="color-swatch" style={{ backgroundColor: providerColor }} />
                  <span className="name-preview-text">Preview: <strong>{providerName.trim()}</strong></span>
                  <span className="color-hex-badge" style={{ backgroundColor: providerColor + "22", color: providerColor }}>
                    {providerColor}
                  </span>
                </div>
              )}

              <div className="form-divider" />

              <div className="items-section">
                <div className="items-section-header">
                  <div className="form-section-label" style={{ margin: 0, border: "none", padding: 0 }}>
                    Current providers
                  </div>
                  <span className="items-count">
                    {providers.length} provider{providers.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {providers.map(provider => (
                  <div className="item-row" key={provider.name}>
                    <span className="item-dot"         style={{ backgroundColor: provider.color }} />
                    <span className="item-name">{provider.name}</span>
                    <span className="item-color-swatch" style={{ backgroundColor: provider.color }} />
                    <span className="item-meta">{provider.color}</span>
                    <button className="item-edit-btn"   onClick={() => setEditingProvider({ ...provider, _originalName: provider.name })}>Edit</button>
                    <button className="item-remove-btn" onClick={() => requestRemoveProvider(provider)}>Remove</button>
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
                  <span className="name-preview-text">
                    Patient: <strong>{[waitlistLastName, waitlistFirstName].filter(Boolean).join(", ")}</strong>
                  </span>
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
                {([1, 2, 3] as const).map(tier => (
                  <button
                    key={tier}
                    className={["tier-card", waitlistTier === tier ? `tier-card-selected tier-${tier}-selected` : ""].join(" ")}
                    onClick={() => { setWaitlistTier(tier); setWaitlistReason(getTierReason(tier)); }}
                  >
                    <div className="tier-card-top">
                      <span className="tier-card-num">Tier {tier}</span>
                      <span className={`tier-badge tier-${tier}`}>{getTierReason(tier)}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="form-section-label">Availability</div>
              <div style={{ marginBottom: 14 }}>
                <div className="field-label-text" style={{ marginBottom: 8 }}>Available days</div>
                <div className="day-pill-group">
                  {DAY_LABELS.map(day => (
                    <button
                      key={day.code}
                      className={["day-pill", waitlistAvailableDays.includes(day.code) ? "day-pill-selected" : ""].join(" ")}
                      onClick={() => toggleWaitlistAvailableDay(day.code)}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <p className="field-hint">Leave blank to indicate any day</p>
              </div>

              <div className="time-range-builder" style={{ marginBottom: 28 }}>
                <div className="time-range-builder-header">
                  <span className="field-label-text">Available times</span>
                  <button className="mini-add-button" onClick={addWaitlistAvailableTimeRange}>+ Add time range</button>
                </div>
                {waitlistAvailableTimeRanges.length === 0 ? (
                  <p className="field-hint">No time ranges selected — any time.</p>
                ) : (
                  <div className="time-range-list">
                    {waitlistAvailableTimeRanges.map(range => (
                      <div className="time-range-row" key={range.id}>
                        <label>
                          <span>Start</span>
                          <select value={range.startTime} onChange={e => updateWaitlistAvailableTimeRange(range.id, "startTime", e.target.value)}>
                            {ALL_TIME_OPTIONS.slice(0, -1).map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>End</span>
                          <select value={range.endTime} onChange={e => updateWaitlistAvailableTimeRange(range.id, "endTime", e.target.value)}>
                            {ALL_TIME_OPTIONS.slice(1).map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                          </select>
                        </label>
                        <button className="item-remove-btn" onClick={() => removeWaitlistAvailableTimeRange(range.id)}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="field-hint">Patients need at least a 1-hour overlap with an opening to appear eligible.</p>
              </div>

              <div className="form-submit-row">
                <button className="btn-secondary" onClick={() => setIsActionPageOpen(false)}>Cancel</button>
                <button className="btn-primary"   onClick={addWaitlistEntry}>+ Add to Waitlist</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── IMPORT / EXPORT MODAL ─────────────────────────────────────────── */}
      {isImportExportModalOpen && (
        <div className="modal-backdrop" onClick={closeImportExportModal}>
          <div className="modal-box modal-xl import-export-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Import / Export Waitlist</h2>
                <p className="modal-subtitle">Expected columns: Date added, Name, Provider, Tier, Reason, Dates, Times.</p>
              </div>
              <button className="close-action-button" onClick={closeImportExportModal}>×</button>
            </div>

            <input
              ref={importFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={e => handleImportFile(e.target.files?.[0] ?? null)}
            />

            <div className="import-export-actions">
              <div
                className={["import-dropzone", isImportDragOver ? "drag-over" : ""].join(" ")}
                onDragOver={e => { e.preventDefault(); setIsImportDragOver(true); }}
                onDragLeave={() => setIsImportDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setIsImportDragOver(false);
                  handleImportFile(e.dataTransfer.files?.[0] ?? null);
                }}
              >
                <div className="import-dropzone-title">Drag and drop an Excel file</div>
                <div className="import-dropzone-subtitle">Accepted: .xlsx, .xls, .csv</div>
                <button className="btn-secondary" onClick={() => importFileInputRef.current?.click()}>
                  Select File
                </button>
              </div>

              <div className="export-card">
                <div>
                  <h3>Export active waitlist</h3>
                  <p>Downloads the current waitlisted patients in the same import format.</p>
                </div>
                <button className="btn-primary" onClick={exportWaitlistToExcel}>
                  Export Excel
                </button>
              </div>
            </div>

            {importError && <p className="import-error-message">{importError}</p>}

            {importPreviewRows.length > 0 && (
              <section className="import-preview-section">
                <div className="import-preview-header">
                  <div>
                    <h3>Preview {importFileName ? `— ${importFileName}` : ""}</h3>
                    <p>
                      {importValidRows.length} ready, {importWarningRows.length} warning, {importErrorRows.length} error.
                      Rows with errors will not be imported.
                    </p>
                  </div>
                  <button className="btn-secondary" onClick={clearImportPreview}>Clear</button>
                </div>

                <div className="import-preview-table-wrap">
                  <table className="import-preview-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Status</th>
                        <th>Date Added</th>
                        <th>Name</th>
                        <th>Provider</th>
                        <th>Tier</th>
                        <th>Dates</th>
                        <th>Times</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreviewRows.map(row => (
                        <tr key={row.id} className={`import-row-${row.status.toLowerCase()}`}>
                          <td>{row.rowNumber}</td>
                          <td><span className={`import-status ${row.status.toLowerCase()}`}>{row.status}</span></td>
                          <td>{row.dateAdded || "—"}</td>
                          <td>{formatPersonName(row.firstName, row.lastName)}</td>
                          <td>{row.provider || "—"}</td>
                          <td>{row.tier ? `Tier ${row.tier}` : "—"}</td>
                          <td>{row.availableDays.length > 0 ? row.availableDays.join(", ") : "Any"}</td>
                          <td>{formatAvailableTimes(row.availableTimes)}</td>
                          <td>{row.messages.length > 0 ? row.messages.join(" ") : "Ready to import."}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeImportExportModal}>Close</button>
              <button className="btn-primary" disabled={importValidRows.length === 0} onClick={confirmImportRows}>
                Confirm Import{importValidRows.length > 0 ? ` (${importValidRows.length})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFIRM REMOVAL MODAL ─────────────────────────────────────────── */}
      {pendingRemoval && (
        <div className="modal-backdrop" onClick={() => setPendingRemoval(null)}>
          <div className="modal-box confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{pendingRemoval.title}</h2>
              <button className="close-action-button" onClick={() => setPendingRemoval(null)}>×</button>
            </div>
            <p className="confirm-message">{pendingRemoval.message}</p>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setPendingRemoval(null)}>Cancel</button>
              <button className="btn-danger"    onClick={confirmPendingRemoval}>{pendingRemoval.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT OPENING MODAL ────────────────────────────────────────────── */}
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
                <select
                  value={editingOpening.provider}
                  onChange={e => setEditingOpening({ ...editingOpening, provider: e.target.value })}
                >
                  {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Date</span>
                <input
                  type="date"
                  value={editingOpening.date}
                  onChange={e => setEditingOpening({ ...editingOpening, date: e.target.value })}
                />
              </label>
            </div>
            <div className="form-row" style={{ marginBottom: 20 }}>
              <label className="field-label-block">
                <span className="field-label-text">Start time</span>
                <select
                  value={editingOpening.startTime}
                  onChange={e => setEditingOpening({ ...editingOpening, startTime: e.target.value })}
                >
                  {ALL_TIME_OPTIONS.slice(0, -1).map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                </select>
              </label>
              <label className="field-label-block">
                <span className="field-label-text">End time</span>
                <select
                  value={editingOpening.endTime}
                  onChange={e => setEditingOpening({ ...editingOpening, endTime: e.target.value })}
                >
                  {ALL_TIME_OPTIONS
                    .filter(t => timeToMinutes(t) > timeToMinutes(editingOpening.startTime))
                    .map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setEditingOpening(null)}>Cancel</button>
              <button className="btn-primary"   onClick={saveEditingOpening}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT ENTRY MODAL ──────────────────────────────────────────────── */}
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
                <input
                  type="date"
                  value={editingEntry.dateAdded}
                  onChange={e => setEditingEntry({ ...editingEntry, dateAdded: e.target.value })}
                />
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">First name</span>
                <input
                  value={editingEntry.firstName}
                  onChange={e => setEditingEntry({ ...editingEntry, firstName: e.target.value })}
                />
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Last name</span>
                <input
                  value={editingEntry.lastName}
                  onChange={e => setEditingEntry({ ...editingEntry, lastName: e.target.value })}
                />
              </label>
            </div>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Provider</span>
                <select
                  value={editingEntry.provider}
                  onChange={e => setEditingEntry({ ...editingEntry, provider: e.target.value })}
                >
                  {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </label>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Reason</span>
                {/* NOTE: Selecting a new tier will overwrite a custom reason with the tier default. */}
                <input
                  value={editingEntry.reason}
                  onChange={e => setEditingEntry({ ...editingEntry, reason: e.target.value })}
                />
              </label>
            </div>
            <div className="form-section-label">Priority tier</div>
            <div className="tier-card-grid" style={{ marginBottom: 18 }}>
              {([1, 2, 3] as const).map(tier => (
                <button
                  key={tier}
                  className={["tier-card", editingEntry.tier === tier ? `tier-card-selected tier-${tier}-selected` : ""].join(" ")}
                  onClick={() => setEditingEntry({ ...editingEntry, tier, reason: getTierReason(tier) })}
                >
                  <div className="tier-card-top">
                    <span className="tier-card-num">Tier {tier}</span>
                    <span className={`tier-badge tier-${tier}`}>{getTierReason(tier)}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="form-section-label">Availability</div>
            <div style={{ marginBottom: 12 }}>
              <div className="field-label-text" style={{ marginBottom: 8 }}>Available days</div>
              <div className="day-pill-group">
                {DAY_LABELS.map(day => (
                  <button
                    key={day.code}
                    className={["day-pill", editingEntry.availableDays.includes(day.code) ? "day-pill-selected" : ""].join(" ")}
                    onClick={() => setEditingEntry({
                      ...editingEntry,
                      availableDays: editingEntry.availableDays.includes(day.code)
                        ? editingEntry.availableDays.filter(d => d !== day.code)
                        : [...editingEntry.availableDays, day.code],
                    })}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="time-range-builder" style={{ marginBottom: 20 }}>
              <div className="time-range-builder-header">
                <span className="field-label-text">Available times</span>
                <button className="mini-add-button" onClick={addEditingEntryTimeRange}>+ Add time range</button>
              </div>
              {editingEntry.availableTimes.length === 0 ? (
                <p className="field-hint">No time ranges selected — any time.</p>
              ) : (
                <div className="time-range-list">
                  {editingEntry.availableTimes.map((range, index) => {
                    const parsed = rangeToDraft(range, index);
                    return (
                      <div className="time-range-row" key={`${range}-${index}`}>
                        <label>
                          <span>Start</span>
                          <select value={parsed.startTime} onChange={e => updateEditingEntryTimeRange(index, "startTime", e.target.value)}>
                            {ALL_TIME_OPTIONS.slice(0, -1).map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>End</span>
                          <select value={parsed.endTime} onChange={e => updateEditingEntryTimeRange(index, "endTime", e.target.value)}>
                            {ALL_TIME_OPTIONS.slice(1).map(t => <option key={t} value={t}>{formatDisplayTime(t)}</option>)}
                          </select>
                        </label>
                        <button className="item-remove-btn" onClick={() => removeEditingEntryTimeRange(index)}>Remove</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setEditingEntry(null)}>Cancel</button>
              <button className="btn-primary"   onClick={saveEditingEntry}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PROVIDER MODAL ───────────────────────────────────────────── */}
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
                <input
                  value={editingProvider.name}
                  onChange={e => setEditingProvider({ ...editingProvider, name: e.target.value })}
                />
              </label>
            </div>
            <div className="form-row" style={{ marginBottom: 20 }}>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Calendar color</span>
                <div className="color-field-row">
                  <span className="color-swatch" style={{ backgroundColor: editingProvider.color }} />
                  <input
                    type="color"
                    value={editingProvider.color}
                    onChange={e => setEditingProvider({ ...editingProvider, color: e.target.value })}
                    style={{ flex: 1 }}
                  />
                </div>
              </label>
              <div className="name-preview-bar" style={{ flex: 1, alignSelf: "flex-end" }}>
                <span className="color-swatch" style={{ backgroundColor: editingProvider.color }} />
                <span className="name-preview-text">Preview: <strong>{editingProvider.name || "—"}</strong></span>
                <span
                  className="color-hex-badge"
                  style={{ backgroundColor: editingProvider.color + "22", color: editingProvider.color }}
                >
                  {editingProvider.color}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setEditingProvider(null)}>Cancel</button>
              <button className="btn-primary"   onClick={saveEditingProvider}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT / EXPORT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function parseImportedWaitlistSheet(sheet: XLSX.WorkSheet): ImportPreviewRow[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];
  const indexedRows = rows
    .map((cells, index) => ({ cells, rowNumber: index + 1 }))
    .filter(row => !isImportedSheetRowEmpty(row.cells));

  if (indexedRows.length === 0) return [];

  const dataRows = looksLikeImportHeaderRow(indexedRows[0].cells) ? indexedRows.slice(1) : indexedRows;
  return dataRows
    .filter(row => !isImportedSheetRowEmpty(row.cells))
    .map((row, index) => parseImportedWaitlistRow(row.cells, row.rowNumber, index + 1));
}

function annotateImportedProviders(rows: ImportPreviewRow[], providers: Provider[]): ImportPreviewRow[] {
  const existing = new Set(providers.map(p => p.name.trim().toLowerCase()));
  const seenNew = new Set<string>();

  return rows.map(row => {
    if (row.status === "ERROR") return row;
    const key = row.provider.trim().toLowerCase();
    if (!key || existing.has(key)) return row;

    const message = seenNew.has(key)
      ? "New provider already listed in this import."
      : "New provider will be added.";
    seenNew.add(key);

    return {
      ...row,
      status: "WARNING",
      messages: [...row.messages, message],
    };
  });
}

function parseImportedWaitlistRow(cells: unknown[], rowNumber: number, id: number): ImportPreviewRow {
  const raw = {
    dateAdded: cellToImportText(cells[0]),
    name:      cellToImportText(cells[1]),
    provider:  cellToImportText(cells[2]),
    tier:      cellToImportText(cells[3]),
    dates:     cellToImportText(cells[5]),
    times:     cellToImportText(cells[6]),
  };

  const messages: string[] = [];
  const parsedDate = parseImportedDate(cells[0]);
  if (!parsedDate) messages.push("Invalid date added.");

  const parsedName = parseImportedName(raw.name);
  if (!parsedName) messages.push("Missing name.");

  const provider = raw.provider.trim();
  if (!provider) messages.push("Missing provider.");

  const tier = parseImportedTier(raw.tier);
  if (!tier) messages.push("Tier must be 1, 2, or 3.");

  const parsedDays = parseImportedDays(raw.dates);
  if (parsedDays.error) messages.push(parsedDays.error);

  const parsedTimes = parseImportedTimeRanges(raw.times);
  if (parsedTimes.error) messages.push(parsedTimes.error);

  return {
    id,
    rowNumber,
    dateAdded:      parsedDate ?? "",
    firstName:      parsedName?.firstName ?? "",
    lastName:       parsedName?.lastName ?? raw.name.trim(),
    provider,
    tier:           tier ?? 1,
    reason:         getTierReason(tier ?? 1),
    availableDays:  parsedDays.days,
    availableTimes: parsedTimes.ranges,
    status:         messages.length > 0 ? "ERROR" : "READY",
    messages,
    raw,
  };
}

function isImportedSheetRowEmpty(cells: unknown[]): boolean {
  return cells.every(cell => cellToImportText(cell).trim() === "");
}

function looksLikeImportHeaderRow(cells: unknown[]): boolean {
  const normalized = cells.map(cell => cellToImportText(cell).toLowerCase().replace(/[^a-z]/g, ""));
  return normalized.includes("dateadded") && normalized.includes("name") && normalized.includes("provider");
}

function cellToImportText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return toDateInputValue(value);
  return String(value).trim();
}

function parseImportedDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toDateInputValue(value);

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(parsed.y, parsed.m - 1, parsed.d);
      return toDateInputValue(date);
    }
  }

  const text = cellToImportText(value).trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day   = Number(match[2]);
  let year    = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return toDateInputValue(date);
}

function parseImportedName(value: string): { firstName: string; lastName: string } | null {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return null;

  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",");
    return { firstName: rest.join(",").trim(), lastName: last.trim() };
  }

  const parts = clean.split(" ");
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function parseImportedTier(value: string): 1 | 2 | 3 | null {
  const match = value.match(/[123]/);
  if (!match) return null;
  const tier = Number(match[0]);
  return tier === 1 || tier === 2 || tier === 3 ? tier : null;
}

function parseImportedDays(value: string): { days: DayCode[]; error?: string } {
  const text = value.trim();
  if (!text || /^any$/i.test(text)) return { days: [] };

  const days: DayCode[] = [];
  const invalid: string[] = [];
  const tokens = text.split(/[\s,;/]+/).map(t => t.trim()).filter(Boolean);

  for (const token of tokens) {
    const parsed = parseImportedDayCode(token);
    if (!parsed) {
      invalid.push(token);
      continue;
    }
    if (!days.includes(parsed)) days.push(parsed);
  }

  return invalid.length > 0
    ? { days, error: `Invalid date value: ${invalid.join(", ")}.` }
    : { days };
}

function parseImportedDayCode(token: string): DayCode | null {
  const clean = token.toLowerCase().replace(/[^a-z]/g, "");
  if (["m", "mon", "monday"].includes(clean)) return "M";
  if (["t", "tu", "tue", "tues", "tuesday"].includes(clean)) return "Tu";
  if (["w", "wed", "wednesday"].includes(clean)) return "W";
  if (["th", "thu", "thur", "thurs", "thursday"].includes(clean)) return "Th";
  if (["f", "fri", "friday"].includes(clean)) return "F";
  return null;
}

function parseImportedTimeRanges(value: string): { ranges: string[]; error?: string } {
  const text = value.trim();
  if (!text || /^any$/i.test(text)) return { ranges: [] };

  const ranges: string[] = [];
  const invalid: string[] = [];
  const pieces = text
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .split(/[,;/]+/)
    .map(piece => piece.trim())
    .filter(Boolean);

  for (const piece of pieces) {
    const parsed = parseSingleImportedTimeRange(piece);
    if (!parsed) {
      invalid.push(piece);
      continue;
    }
    ranges.push(`${minutesToTimeString(parsed.start)}-${minutesToTimeString(parsed.end)}`);
  }

  return invalid.length > 0
    ? { ranges, error: `Invalid time range: ${invalid.join(", ")}.` }
    : { ranges };
}

function parseSingleImportedTimeRange(value: string): TimeWindow | null {
  const match = value.match(/^(.+?)-(.+)$/);
  if (!match) return null;

  const startClock = parseImportedClock(match[1]);
  const endClock   = parseImportedClock(match[2]);
  if (!startClock || !endClock) return null;

  let startSuffix = startClock.suffix;
  let endSuffix   = endClock.suffix;

  if (!startSuffix && endSuffix) {
    if (endSuffix === "pm") {
      startSuffix = startClock.hour === 12 ? "pm" : startClock.hour > endClock.hour && startClock.hour >= 8 ? "am" : "pm";
    } else {
      startSuffix = "am";
    }
  }

  if (startSuffix && !endSuffix) {
    if (startSuffix === "am" && endClock.hour < startClock.hour) endSuffix = "pm";
    else endSuffix = startSuffix;
  }

  const start = importedClockToMinutes({ ...startClock, suffix: startSuffix });
  const end   = importedClockToMinutes({ ...endClock,   suffix: endSuffix   });

  if (start < CAL_START_MIN || end > CAL_END_MIN || end <= start || !hasOneHourSlot(start, end)) return null;
  return { start, end };
}

function parseImportedClock(value: string): { hour: number; minute: number; suffix?: "am" | "pm" } | null {
  const clean = value.trim().toLowerCase().replace(/\s+/g, "");
  const suffixMatch = clean.match(/(am|pm|a|p)$/);
  const suffix = suffixMatch ? (suffixMatch[1].startsWith("a") ? "am" : "pm") : undefined;
  const body = suffixMatch ? clean.slice(0, -suffixMatch[1].length) : clean;
  const match = body.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  return { hour, minute, suffix };
}

function importedClockToMinutes(clock: { hour: number; minute: number; suffix?: "am" | "pm" }): number {
  if (!clock.suffix) return timeToMinutes(`${clock.hour}:${String(clock.minute).padStart(2, "0")}`);
  const hour24 = clock.suffix === "pm" ? (clock.hour % 12) + 12 : clock.hour % 12;
  return hour24 * 60 + clock.minute;
}

function formatDateForExport(dateString: string): string {
  const date = parseLocalDate(dateString);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function formatAvailableTimesForExport(times: string[]): string {
  return times
    .map(range => {
      const { start, end } = parseTimeRange(range);
      return `${formatClockForExport(start)}-${formatClockForExport(end)}`;
    })
    .join(",");
}

function formatClockForExport(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}${minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`}${suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// Date utilities ────────────────────────────────────────────────────────────

function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTodayDateInputValue(): string {
  return toDateInputValue(new Date());
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Returns the Monday of the current week. If today is Sunday, returns next Monday. */
function getCurrentWeekStartDate(): string {
  const date = startOfLocalDay(new Date());
  const day  = date.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  let daysToMonday = day === 0 ? 1 : 1 - day;
  if (day === 6) daysToMonday = 2;
  date.setDate(date.getDate() + daysToMonday);
  return toDateInputValue(date);
}

/** Returns today if it's a weekday, or the following Monday for weekends. */
function getDefaultOpeningDate(): string {
  const date = startOfLocalDay(new Date());
  const day  = date.getDay();
  if (day === 6) date.setDate(date.getDate() + 2); // Saturday → Monday
  if (day === 0) date.setDate(date.getDate() + 1); // Sunday  → Monday
  return toDateInputValue(date);
}

function moveDateByDays(dateString: string, days: number): string {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function isDateAtLeastRetentionDaysOld(dateString: string, today: Date): boolean {
  const cutoff = startOfLocalDay(today);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  return parseLocalDate(dateString).getTime() <= cutoff.getTime();
}

function isPastDate(dateString: string, todayDateString: string): boolean {
  return parseLocalDate(dateString).getTime() < parseLocalDate(todayDateString).getTime();
}

function formatDisplayDate(dateString: string): string {
  return parseLocalDate(dateString).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

//  Day code utilities ────────────────────────────────────────────────────────

/**
 * Returns the DayCode (M/Tu/W/Th/F) for a given YYYY-MM-DD date.
 * Returns null for Saturday and Sunday — callers should handle this.
*/

function getDayCodeFromDate(dateString: string): DayCode | null {
  const day = parseLocalDate(dateString).getDay();
  if (day === 1) return "M";
  if (day === 2) return "Tu";
  if (day === 3) return "W";
  if (day === 4) return "Th";
  if (day === 5) return "F";
  return null; // 0 = Sunday, 6 = Saturday
}

// Time conversion utilities ─────────────────────────────────────────────────
//
// Times are stored as "H:MM" strings in 12-hour format without AM/PM.
// The calendar range is 8 AM – 6 PM (480–1080 minutes from midnight).
// Hours 1–7 are treated as PM (1:00 → 13:00, …, 7:00 → 19:00).
// Hours 8–12 are treated as AM/noon as-is.
//

/** Converts "H:MM" storage format to absolute minutes from midnight. */
function timeToMinutes(time: string): number {
  const [hourStr, minuteStr] = time.split(":");
  let hour        = Number(hourStr);
  const minute    = Number(minuteStr ?? "0");
  // Ambiguous hours 1–7 are in the PM range (1 PM – 7 PM).
  if (hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + minute;
}

/** Converts absolute minutes from midnight back to "H:MM" storage format. */
function minutesToTimeString(totalMinutes: number): string {
  const hour  = Math.floor(totalMinutes / 60);
  const min   = totalMinutes % 60;
  const disp  = hour > 12 ? hour - 12 : hour;
  return `${disp}:${String(min).padStart(2, "0")}`;
}

/** Formats "H:MM" storage value to "H:MM AM/PM" for display. */
function formatDisplayTime(time: string): string {
  const totalMinutes = timeToMinutes(time);
  const hour24 = Math.floor(totalMinutes / 60);
  const minute  = totalMinutes % 60;
  const suffix  = hour24 >= 12 ? "PM" : "AM";
  const hour12  = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(startTime: string, endTime: string): string {
  return `${formatDisplayTime(startTime)} – ${formatDisplayTime(endTime)}`;
}

function snapToInterval(minutes: number, interval: number): number {
  return Math.round(minutes / interval) * interval;
}

// Calendar positioning helpers ──────────────────────────────────────────────

function getOpeningTopPct(startTime: string): number {
  return ((timeToMinutes(startTime) - CAL_START_MIN) / CAL_SPAN) * 100;
}

function getOpeningHeightPct(startTime: string, endTime: string): number {
  return ((timeToMinutes(endTime) - timeToMinutes(startTime)) / CAL_SPAN) * 100;
}

// Time range / availability helpers ────────────────────────────────────────

/** Parses a serialized "H:MM-H:MM" range into {start, end} minutes. */
function parseTimeRange(range: string): { start: number; end: number } {
  const [start, end] = range.split("-").map(part => part.trim());
  return { start: timeToMinutes(start), end: timeToMinutes(end) };
}

function hasOneHourSlot(start: number, end: number): boolean {
  return end - start >= 60;
}

function getOverlapWindow(aStart: number, aEnd: number, bStart: number, bEnd: number): TimeWindow | null {
  const start = Math.max(aStart, bStart);
  const end   = Math.min(aEnd,   bEnd);
  return hasOneHourSlot(start, end) ? { start, end } : null;
}

/**
 * Returns all minute-windows where the entry's availability overlaps the opening,
 * each at least 60 minutes long.
 *
 * Special case: Tier-1 entries with no day or time restrictions are treated as
 * fully flexible — they match any opening.
 */
function getEligibleScheduleWindows(entry: WaitlistEntry, opening: Opening): TimeWindow[] {
  const isFlexibleUrgent = entry.tier === 1 && entry.availableDays.length === 0 && entry.availableTimes.length === 0;
  const dayMatches = isFlexibleUrgent || entry.availableDays.length === 0 || entry.availableDays.includes(opening.day);
  if (!dayMatches) return [];

  const openingStart = timeToMinutes(opening.startTime);
  const openingEnd   = timeToMinutes(opening.endTime);

  // No time restrictions — the whole opening is the window.
  if (entry.availableTimes.length === 0) {
    return hasOneHourSlot(openingStart, openingEnd) ? [{ start: openingStart, end: openingEnd }] : [];
  }

  return entry.availableTimes
    .map(parseTimeRange)
    .map(r => getOverlapWindow(r.start, r.end, openingStart, openingEnd))
    .filter((w): w is TimeWindow => w !== null);
}

function isEntryAvailableForOpening(entry: WaitlistEntry, opening: Opening): boolean {
  return getEligibleScheduleWindows(entry, opening).length > 0;
}

function formatAvailableTimes(times: string[]): string {
  if (times.length === 0) return "Any";
  return times
    .map(range => {
      const { start, end } = parseTimeRange(range);
      return formatTimeRange(minutesToTimeString(start), minutesToTimeString(end));
    })
    .join(", ");
}

function formatAvailability(days: DayCode[], times: string[]): string {
  return `${days.length > 0 ? days.join(", ") : "Any"}; ${formatAvailableTimes(times)}`;
}

// Schedule selection helpers ────────────────────────────────────────────────

/** Generates all valid start-time options (every SNAP minutes) across eligible windows. */
function getScheduleStartOptions(windows: TimeWindow[]): string[] {
  return uniqueSortedTimes(windows.flatMap(w => {
    const options: string[] = [];
    for (let min = w.start; min <= w.end - 60; min += SNAP) {
      options.push(minutesToTimeString(min));
    }
    return options;
  }));
}

/** Generates all valid end-time options for a given start time. */
function getScheduleEndOptions(windows: TimeWindow[], startTime: string): string[] {
  const start = timeToMinutes(startTime);
  return uniqueSortedTimes(windows.flatMap(w => {
    if (start < w.start || start + 60 > w.end) return [];
    const options: string[] = [];
    for (let min = start + 60; min <= w.end; min += SNAP) {
      options.push(minutesToTimeString(min));
    }
    return options;
  }));
}

function getDefaultScheduleSelection(windows: TimeWindow[]): ScheduleSelection {
  const first = windows[0] ?? { start: CAL_START_MIN, end: CAL_START_MIN + 60 };
  return {
    startTime: minutesToTimeString(first.start),
    endTime:   minutesToTimeString(Math.min(first.start + 60, first.end)),
  };
}

/**
 * Normalizes a selection so it stays within valid option sets after either field changes.
 * Falls back gracefully if the current values are no longer valid.
 */
function normalizeScheduleSelection(
  selection: ScheduleSelection,
  changedField: "startTime" | "endTime",
  windows: TimeWindow[],
): ScheduleSelection {
  const startOptions = getScheduleStartOptions(windows);
  if (startOptions.length === 0) return getDefaultScheduleSelection(windows);

  let startTime = selection.startTime;
  if (!startOptions.includes(startTime)) startTime = startOptions[0];

  let endOptions = getScheduleEndOptions(windows, startTime);
  if (endOptions.length === 0) {
    startTime  = startOptions[0];
    endOptions = getScheduleEndOptions(windows, startTime);
  }

  let endTime = selection.endTime;
  const endTooEarly = timeToMinutes(endTime) - timeToMinutes(startTime) < 60;
  if (!endOptions.includes(endTime) || (changedField === "startTime" && endTooEarly)) {
    endTime = endOptions[0];
  }

  return { startTime, endTime };
}

/** Returns the user's saved selection for an entry, validated against current windows. */
function getResolvedScheduleSelection(
  entry: WaitlistEntry,
  opening: Opening,
  saved?: ScheduleSelection,
): ScheduleSelection {
  const windows = getEligibleScheduleWindows(entry, opening);
  return normalizeScheduleSelection(
    saved ?? getDefaultScheduleSelection(windows),
    "endTime",
    windows,
  );
}

// Time range draft helpers ──────────────────────────────────────────────────

function getNextTimeRangeId(ranges: TimeRangeDraft[]): number {
  return ranges.length === 0 ? 1 : Math.max(...ranges.map(r => r.id)) + 1;
}

/** Parses a serialized "H:MM-H:MM" string into a TimeRangeDraft. */
function rangeToDraft(range: string, fallbackId = 0): TimeRangeDraft {
  const parsed = parseTimeRange(range);
  return {
    id:        fallbackId,
    startTime: minutesToTimeString(parsed.start),
    endTime:   minutesToTimeString(parsed.end),
  };
}

/** Ensures the draft's start/end are at least 60 minutes apart, clamped to calendar bounds. */
function normalizeDraftTimeRange(range: TimeRangeDraft, changedField: "startTime" | "endTime"): TimeRangeDraft {
  let start = timeToMinutes(range.startTime);
  let end   = timeToMinutes(range.endTime);

  if (end - start < 60) {
    if (changedField === "startTime") {
      end   = Math.min(CAL_END_MIN, start + 60);
      if (end - start < 60) start = end - 60;
    } else {
      start = Math.max(CAL_START_MIN, end - 60);
      if (end - start < 60) end = start + 60;
    }
  }

  return { ...range, startTime: minutesToTimeString(start), endTime: minutesToTimeString(end) };
}

/** Converts draft ranges back to serialized "H:MM-H:MM" strings, filtering invalid entries. */
function serializeTimeRangeDrafts(ranges: TimeRangeDraft[]): string[] {
  return ranges
    .map(r => normalizeDraftTimeRange(r, "endTime"))
    .filter(r => hasOneHourSlot(timeToMinutes(r.startTime), timeToMinutes(r.endTime)))
    .map(r => `${r.startTime}-${r.endTime}`);
}

// Opening data helpers ──────────────────────────────────────────────────────

/**
 * Removes the appointment slot from the opening, splitting it into up to two
 * pieces if the appointment is in the middle.
 */
function splitOpeningForAppointment(
  openings: Opening[],
  openingId: number,
  appointmentStartTime: string,
  appointmentEndTime: string,
): Opening[] {
  const apptStart = timeToMinutes(appointmentStartTime);
  const apptEnd   = timeToMinutes(appointmentEndTime);
  let nextId      = getNextId(openings);

  const split = openings.flatMap(opening => {
    if (opening.id !== openingId) return [opening];

    const oStart = timeToMinutes(opening.startTime);
    const oEnd   = timeToMinutes(opening.endTime);

    if (apptStart <= oStart && apptEnd >= oEnd) return []; // appointment covers entire opening
    if (apptStart <= oStart) return [{ ...opening, startTime: minutesToTimeString(apptEnd) }];
    if (apptEnd   >= oEnd)   return [{ ...opening, endTime:   minutesToTimeString(apptStart) }];

    // Appointment is in the middle — split into two.
    return [
      { ...opening, endTime:   minutesToTimeString(apptStart) },
      { ...opening, id: nextId++, startTime: minutesToTimeString(apptEnd) },
    ];
  });

  return mergeSameProviderOpenings(split);
}

/**
 * Merges adjacent or overlapping openings from the same provider on the same day.
 * `preferredId` ensures that after a drag or edit, the result block retains the
 * original opening's id (so selection state is preserved).
 */
function mergeSameProviderOpenings(openings: Opening[], preferredId?: number | null): Opening[] {
  const groups = new Map<string, Opening[]>();

  for (const opening of openings) {
    const key = `${opening.provider}__${opening.date}`;
    groups.set(key, [...(groups.get(key) ?? []), opening]);
  }

  const merged: Opening[] = [];

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      return diff !== 0 ? diff : timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
    });

    let current:    Opening | null = null;
    let currentIds: Set<number>    = new Set();

    for (const opening of sorted) {
      if (current === null) {
        current    = { ...opening };
        currentIds = new Set([opening.id]);
        continue;
      }

      const currentEnd   = timeToMinutes(current.endTime);
      const openingStart = timeToMinutes(opening.startTime);
      const openingEnd   = timeToMinutes(opening.endTime);

      if (openingStart <= currentEnd) {
        // Overlapping or adjacent — extend the current block.
        current.endTime = minutesToTimeString(Math.max(currentEnd, openingEnd));
        currentIds.add(opening.id);
        continue;
      }

      if (preferredId != null && currentIds.has(preferredId)) current.id = preferredId;
      merged.push(current);
      current    = { ...opening };
      currentIds = new Set([opening.id]);
    }

    if (current !== null) {
      if (preferredId != null && currentIds.has(preferredId)) current.id = preferredId;
      merged.push(current);
    }
  }

  return merged.sort((a, b) => {
    const dateDiff = a.date.localeCompare(b.date);
    if (dateDiff !== 0) return dateDiff;
    const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    if (startDiff !== 0) return startDiff;
    return a.provider.localeCompare(b.provider);
  });
}

// Calendar segment rendering helpers ───────────────────────────────────────

/**
 * Builds the list of OpeningSegments for one day column.
 *
 * Strategy: collect all unique time breakpoints from that day's openings, then
 * for each breakpoint interval determine which openings are active. Active openings
 * share the column width equally. Adjacent same-opening segments are merged back
 * together, then labelled and connected (first/last piece flags).
 */
function buildOpeningSegments(dayOpenings: Opening[]): OpeningSegment[] {
  // Collect all start/end times as breakpoints.
  const points = new Set<number>();
  dayOpenings.forEach(o => { points.add(timeToMinutes(o.startTime)); points.add(timeToMinutes(o.endTime)); });
  const breakpoints = [...points].sort((a, b) => a - b);

  const rawSegments: OpeningSegment[] = [];

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const segStart = breakpoints[i];
    const segEnd   = breakpoints[i + 1];

    // Which openings are active during this interval?
    const activeOpenings = dayOpenings
      .filter(o => timeToMinutes(o.startTime) < segEnd && timeToMinutes(o.endTime) > segStart)
      .sort((a, b) => {
        const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        return diff !== 0 ? diff : a.provider.localeCompare(b.provider);
      });

    activeOpenings.forEach((opening, index) => {
      const count = activeOpenings.length;
      rawSegments.push({
        opening,
        startTime:    minutesToTimeString(segStart),
        endTime:      minutesToTimeString(segEnd),
        left:         `calc(${(index / count) * 100}% + 4px)`,
        width:        `calc(${100 / count}% - 8px)`,
        widthPercent: 100 / count,
        index,
        showLabel:    false,
        isFirstPiece: false,
        isLastPiece:  false,
      });
    });
  }

  return labelAndConnectOpeningSegments(mergeAdjacentOpeningSegments(rawSegments));
}

/** Merges consecutive segments for the same opening when they share column position. */
function mergeAdjacentOpeningSegments(segments: OpeningSegment[]): OpeningSegment[] {
  const merged: OpeningSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.opening.id === seg.opening.id &&
      prev.endTime    === seg.startTime  &&
      prev.left       === seg.left       &&
      prev.width      === seg.width
    ) {
      prev.endTime = seg.endTime; // extend
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/** Marks each segment with showLabel, isFirstPiece, isLastPiece for rendering. */
function labelAndConnectOpeningSegments(segments: OpeningSegment[]): OpeningSegment[] {
  return segments.map(segment => {
    const same  = segments.filter(s => s.opening.id === segment.opening.id);
    const first = same.reduce((b, c) => timeToMinutes(c.startTime) < timeToMinutes(b.startTime) ? c : b);
    const last  = same.reduce((b, c) => timeToMinutes(c.endTime)   > timeToMinutes(b.endTime)   ? c : b);
    // Label goes on the widest (or longest) segment.
    const label = same.reduce((b, c) => {
      if (c.widthPercent > b.widthPercent) return c;
      if (c.widthPercent === b.widthPercent) {
        const bDur = timeToMinutes(b.endTime) - timeToMinutes(b.startTime);
        const cDur = timeToMinutes(c.endTime) - timeToMinutes(c.startTime);
        return cDur > bDur ? c : b;
      }
      return b;
    });

    return {
      ...segment,
      showLabel:    segment.startTime === label.startTime && segment.endTime === label.endTime && segment.left === label.left,
      isFirstPiece: segment.startTime === first.startTime && segment.left === first.left && segment.width === first.width,
      isLastPiece:  segment.endTime   === last.endTime    && segment.left === last.left  && segment.width === last.width,
    };
  });
}

// General utilities ─────────────────────────────────────────────────────────

/** Builds an array of "H:MM" time strings from startMin to endMin in stepMin increments. */
function buildTimeOptions(startMin: number, endMin: number, stepMin: number): string[] {
  const options: string[] = [];
  for (let min = startMin; min <= endMin; min += stepMin) {
    options.push(minutesToTimeString(min));
  }
  return options;
}

function uniqueSortedTimes(times: string[]): string[] {
  return [...new Set(times)].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

/** Returns a new array only if the filter actually removed items, avoiding spurious re-renders. */
function filterWithoutStateChange<T>(items: T[], keep: (item: T) => boolean): T[] {
  const filtered = items.filter(keep);
  return filtered.length === items.length ? items : filtered;
}

function getNextId(items: { id: number }[]): number {
  return items.length === 0 ? 1 : Math.max(...items.map(i => i.id)) + 1;
}

function formatPersonName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last  = lastName.trim();
  if (first && last) return `${last}, ${first}`;
  return last || first || "—";
}

function getFullName(entry: WaitlistEntry): string {
  return formatPersonName(entry.firstName, entry.lastName);
}

function getTierReason(tier: 1 | 2 | 3): string {
  if (tier === 1) return "Urgent";
  if (tier === 2) return "Semi-urgent";
  return "Routine";
}

function compareScheduledRecordsByAppointment(a: ScheduledRecord, b: ScheduledRecord): number {
  const dateDiff = a.appointmentDate.localeCompare(b.appointmentDate);
  if (dateDiff !== 0) return dateDiff;
  const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  if (startDiff !== 0) return startDiff;
  return a.lastName.localeCompare(b.lastName);
}

function getSortIndicator(current: SortField, direction: "asc" | "desc", column: SortField): string {
  if (current !== column) return "";
  return direction === "asc" ? "↑" : "↓";
}

export default App;