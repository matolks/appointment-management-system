/*
 * Copyright (c) 2026 Vince Matolka.
 * All rights reserved.
 *
 * This file is part of Appointment Manager.
 * Unauthorized copying, modification, distribution, or use is prohibited
 * without written permission from the copyright owner.
 */

// Backsups, be able to go back more not just toggle
// How to maintain if necessary - for now maybe not needed.

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import "./App.css";

import type {
  ActionMode,
  DayCode,
  ImportPreviewRow,
  Opening,
  PendingRemoval,
  PersistedAppState,
  Provider,
  RemovedRecord,
  ScheduleSelection,
  ScheduledRecord,
  SortField,
  TimeRangeDraft,
  TimeWindow,
  ViewMode,
  WaitlistEntry,
  WaitlistHistoryPanel,
} from "./types";

// One visible slice of an opening
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

const CAL_START_MIN = 8 * 60;
const CAL_END_MIN = 18 * 60;
const CAL_SPAN = CAL_END_MIN - CAL_START_MIN;
const SNAP = 5;
const BASE_APPOINTMENT_MINUTES = 20;
const SURGERY_APPOINTMENT_MINUTES = 30;
const RETENTION_DAYS = 14;
const STORAGE_SAVE_DEBOUNCE_MS = 500;
const TIME_SLOT_LABELS = buildTimeOptions(CAL_START_MIN, CAL_END_MIN - 60, 60);
const ALL_TIME_OPTIONS = buildTimeOptions(CAL_START_MIN, CAL_END_MIN, SNAP);
const DEFAULT_PROVIDER_COLOR = "#5877ff";
const IMPORT_PROVIDER_COLORS = [
  "#5877ff", "#c9a227", "#6db870", "#d06060", "#9a77ff",
  "#4ca6a8", "#d47a3c", "#cc66aa", "#7898d8", "#7a9a54",
];

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function App(){
  const [activeView, setActiveView] = useState<ViewMode>("CALENDAR");
  const [waitlistHistoryPanel, setWaitlistHistoryPanel] = useState<WaitlistHistoryPanel>("ACTIVE");
  const [actionMode, setActionMode] = useState<ActionMode>("OPENING");
  const [isActionPageOpen, setIsActionPageOpen] = useState(false);
  const [activeWaitlistSearch, setActiveWaitlistSearch] = useState("");
  const [scheduledSearch, setScheduledSearch] = useState("");
  const [removedSearch, setRemovedSearch] = useState("");
  const [calendarLocked, setCalendarLocked] = useState(true);
  const [selectedOpeningId, setSelectedOpeningId] = useState<number | null>(null);
  const [hoveredOpeningId, setHoveredOpeningId] = useState<number | null>(null);
  const [weekStartDate, setWeekStartDate] = useState<string>(getCurrentWeekStartDate);
  const [editingOpening, setEditingOpening] = useState<EditingOpening  | null>(null);
  const [editingEntry, setEditingEntry] = useState<EditingEntry    | null>(null);
  const [editingProvider, setEditingProvider] = useState<EditingProvider | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval  | null>(null);
  const [reasonPreview, setReasonPreview] = useState<{ title: string; text: string } | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isImportExportModalOpen, setIsImportExportModalOpen] = useState(false);
  const [importPreviewRows, setImportPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState("");
  const [isImportDragOver, setIsImportDragOver] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [scheduledRecords, setScheduledRecords] = useState<ScheduledRecord[]>([]);
  const [removedRecords, setRemovedRecords] = useState<RemovedRecord[]>([]);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [isStorageBusy, setIsStorageBusy] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [scheduleSelections, setScheduleSelections] = useState<Record<number, ScheduleSelection>>({});
  const [openingProvider, setOpeningProvider] = useState("");
  const [openingDate, setOpeningDate] = useState(getDefaultOpeningDate);
  const [openingStartTime, setOpeningStartTime] = useState("8:00");
  const [openingEndTime, setOpeningEndTime] = useState("9:00");
  const [waitlistDateAdded, setWaitlistDateAdded] = useState(getTodayDateInputValue);
  const [waitlistFirstName, setWaitlistFirstName] = useState("");
  const [waitlistLastName, setWaitlistLastName] = useState("");
  const [waitlistProvider, setWaitlistProvider] = useState("");
  const [waitlistTier, setWaitlistTier] = useState<1 | 2 | 3>(1);
  const [waitlistReason, setWaitlistReason] = useState(getTierReason(1));
  const [waitlistAvailableDays, setWaitlistAvailableDays] = useState<DayCode[]>([]);
  const [waitlistAvailableTimeRanges, setWaitlistAvailableTimeRanges] = useState<TimeRangeDraft[]>([]);
  const [providerName, setProviderName] = useState("");
  const [providerColor, setProviderColor] = useState(DEFAULT_PROVIDER_COLOR);

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

  const buildPersistedAppState = useCallback((): PersistedAppState => ({
    version: 1,
    providers,
    entries,
    openings,
    scheduledRecords,
    removedRecords,
  }), [providers, entries, openings, scheduledRecords, removedRecords]);

  function clearCurrentAppState(){
    setProviders([]);
    setEntries([]);
    setOpenings([]);
    setScheduledRecords([]);
    setRemovedRecords([]);
    setScheduleSelections({});
    setSelectedOpeningId(null);
    setHoveredOpeningId(null);
    setEditingOpening(null);
    setEditingEntry(null);
    setEditingProvider(null);
    setPendingRemoval(null);
    setReasonPreview(null);
    setActiveView("CALENDAR");
    setWaitlistHistoryPanel("ACTIVE");
    setIsActionPageOpen(false);
    setIsSettingsModalOpen(false);
    setActiveWaitlistSearch("");
    setScheduledSearch("");
    setRemovedSearch("");
    setOpeningProvider("");
    setOpeningDate(getDefaultOpeningDate());
    setOpeningStartTime("8:00");
    setOpeningEndTime("9:00");
    setWaitlistDateAdded(getTodayDateInputValue());
    setWaitlistFirstName("");
    setWaitlistLastName("");
    setWaitlistProvider("");
    setWaitlistTier(1);
    setWaitlistReason(getTierReason(1));
    setWaitlistAvailableDays([]);
    setWaitlistAvailableTimeRanges([]);
    setProviderName("");
    setProviderColor(DEFAULT_PROVIDER_COLOR);
    clearImportPreview();
  }

  function applyPersistedAppState(saved: PersistedAppState | null){
    if(!saved){
      clearCurrentAppState();
      return;
    }
    setProviders(saved.providers ?? []);
    setEntries(saved.entries ?? []);
    setOpenings(saved.openings ?? []);
    setScheduledRecords(saved.scheduledRecords ?? []);
    setRemovedRecords(saved.removedRecords ?? []);
    setScheduleSelections({});
    setSelectedOpeningId(null);
    setHoveredOpeningId(null);
    setEditingOpening(null);
    setEditingEntry(null);
    setEditingProvider(null);
    setPendingRemoval(null);
    setReasonPreview(null);
    setActiveView("CALENDAR");
    setWaitlistHistoryPanel("ACTIVE");
    setIsActionPageOpen(false);
    setActiveWaitlistSearch("");
    setScheduledSearch("");
    setRemovedSearch("");
    clearImportPreview();
  }

  async function saveCurrentStateToStorage(){
    if(!window.appStorage || !hasLoadedStorage) return;
    await window.appStorage.save(buildPersistedAppState());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadStoredState(){
      if(!window.appStorage){
        setHasLoadedStorage(true);
        return;
      }
      try {
        const saved = await window.appStorage.load();
        if(saved){
          setProviders(saved.providers ?? []);
          setEntries(saved.entries ?? []);
          setOpenings(saved.openings ?? []);
          setScheduledRecords(saved.scheduledRecords ?? []);
          setRemovedRecords(saved.removedRecords ?? []);
        }
        setHasLoadedStorage(true);
      } catch (error){
        console.error("Failed to load app state from SQLite:", error);
        setStorageError("Database load failed. Automatic saving is disabled until the app is restarted.");
        // Still mark as loaded so the app is usable even if storage fails
        setHasLoadedStorage(true);
      }
    }
    loadStoredState();
  }, []);

  useEffect(() => {
    if(!hasLoadedStorage || !window.appStorage) return;
    const saveTimeoutId = window.setTimeout(() => {
      window.appStorage?.save(buildPersistedAppState()).catch(error => {
        console.error("Failed to save app state to SQLite:", error);
        setStorageError("Database save failed. Check the console for details.");
      });
    }, STORAGE_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(saveTimeoutId);
  }, [hasLoadedStorage, buildPersistedAppState]);

  // Retention cleanup 
  useEffect(() => {
    const today = startOfLocalDay(new Date());
    setOpenings(prev =>
      filterWithoutStateChange(prev, o => !isDateOlderThanRetentionDays(o.date, today)),
    );

    setScheduledRecords(prev => {
      const stale = new Set(
        prev
          .filter(r => isDateOlderThanRetentionDays(r.appointmentDate, today))
          .map(r => r.entryId),
      );
      const next = filterWithoutStateChange(prev, r => !isDateOlderThanRetentionDays(r.appointmentDate, today));
      if(stale.size > 0){
        setEntries(e =>
          filterWithoutStateChange(e, entry =>
            !(entry.status === "SCHEDULED" && stale.has(entry.id)),
          ),
        );
      }
      return next;
    });

    setRemovedRecords(prev => {
      const stale = new Set(
        prev
          .filter(r => isDateOlderThanRetentionDays(r.dateRemoved, today))
          .map(r => r.entryId),
      );
      const next = filterWithoutStateChange(prev, r => !isDateOlderThanRetentionDays(r.dateRemoved, today));
      if(stale.size > 0){
        setEntries(e =>
          filterWithoutStateChange(e, entry =>
            !(entry.status === "REMOVED" && stale.has(entry.id)),
          ),
        );
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  useEffect(() => {
    setOpeningProvider(current =>
      providers.some(p => p.name === current) ? current : providers[0]?.name ?? "",
    );
    setWaitlistProvider(current =>
      providers.some(p => p.name === current) ? current : providers[0]?.name ?? "",
    );
  }, [providers]);

  useEffect(() => {
    if(selectedOpeningId !== null && !openings.some(o => o.id === selectedOpeningId)){
      setSelectedOpeningId(null);
    }
  }, [openings, selectedOpeningId]);

  // ─────────────────────────────────────────────────────────────────────────
  // DRAG HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if(!d) return;
    e.preventDefault();
    const dyMin  = ((e.clientY - d.startY) / d.colHeightPx) * CAL_SPAN;
    const minDur = 20;
    setOpenings(prev => prev.map(o => {
      if(o.id !== d.openingId) return o;
      let newStart = d.origStartMin;
      let newEnd   = d.origEndMin;
      if(d.mode === "move"){
        const dur = d.origEndMin - d.origStartMin;
        newStart = snapToInterval(d.origStartMin + dyMin, SNAP);
        newEnd   = newStart + dur;
        if(newStart < CAL_START_MIN){ newStart = CAL_START_MIN; newEnd = newStart + dur; }
        if(newEnd   > CAL_END_MIN)  { newEnd   = CAL_END_MIN;   newStart = newEnd - dur; }
      } else if(d.mode === "resize-top"){
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
    if(finishedDragId !== null){
      setOpenings(prev => mergeSameProviderOpenings(prev, finishedDragId));
      setSelectedOpeningId(finishedDragId);
    }
    dragRef.current = null;
    setDraggingId(null);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  function startDrag(
    e: React.PointerEvent,
    opening: Opening,
    mode: DragState["mode"],
    colHeightPx: number,
  ){
    if(calendarLocked) return;
    e.stopPropagation();
    dragRef.current = {
      openingId: opening.id,
      mode,
      startY: e.clientY,
      origStartMin: timeToMinutes(opening.startTime),
      origEndMin: timeToMinutes(opening.endTime),
      colHeightPx: colHeightPx > 0 ? colHeightPx : 600,
    };
    setDraggingId(opening.id);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SORT STATE
  // ─────────────────────────────────────────────────────────────────────────

  const [sortField, setSortField] = useState<SortField>("dateAdded");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  function handleSortChange(next: SortField){
    if(next === sortField){
      setSortDirection(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(next);
      setSortDirection("asc");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DERIVED / MEMOIZED DATA
  // ─────────────────────────────────────────────────────────────────────────

  const weekDates = useMemo(() => {
    const start = parseLocalDate(weekStartDate);
    return DAY_LABELS.map((day, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return { ...day, date, dateString: toDateInputValue(date) };
    });
  }, [weekStartDate]);

  const selectedOpening = openings.find(o => o.id === selectedOpeningId) ?? null;

  const eligibleEntries = useMemo(() => {
    if(!selectedOpening) return [];
    return entries
      .filter(e =>
        e.status === "WAITLISTED" &&
        e.provider === selectedOpening.provider &&
        isEntryAvailableForOpening(e, selectedOpening),
      )
      .sort((a, b) => a.tier !== b.tier
        ? a.tier - b.tier
        : new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime(),
      );
  }, [entries, selectedOpening]);

  const waitlistedCount = entries.filter(e => e.status === "WAITLISTED").length;
  const scheduledCount  = scheduledRecords.length;
  const importValidRows = importPreviewRows.filter(row => row.status !== "ERROR");
  const importErrorRows = importPreviewRows.filter(row => row.status === "ERROR");
  const importWarningRows = importPreviewRows.filter(row => row.status === "WARNING");
  const todayDateString = getTodayDateInputValue();

  const filteredScheduledRecords = useMemo(
    () => scheduledRecords.filter(record => scheduledRecordMatchesSearch(record, scheduledSearch)),
    [scheduledRecords, scheduledSearch],
  );

  const upcomingScheduledRecords = [...filteredScheduledRecords]
    .filter(r => !isPastDate(r.appointmentDate, todayDateString))
    .sort(compareScheduledRecordsByAppointment);

  const pastScheduledRecords = [...filteredScheduledRecords]
    .filter(r => isPastDate(r.appointmentDate, todayDateString))
    .sort((a, b) => compareScheduledRecordsByAppointment(b, a));

  const filteredRemovedRecords = useMemo(
    () => removedRecords.filter(record => removedRecordMatchesSearch(record, removedSearch)),
    [removedRecords, removedSearch],
  );

  const sortedWaitlistEntries = useMemo(() => {
    const waitlistedOnly = entries
      .filter(e => e.status === "WAITLISTED")
      .filter(e => waitlistEntryMatchesSearch(e, activeWaitlistSearch));
    return [...waitlistedOnly].sort((a, b) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortField){
        case "dateAdded": return (new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()) * dir;
        case "name": return getFullName(a).localeCompare(getFullName(b)) * dir;
        case "provider": return a.provider.localeCompare(b.provider) * dir;
        case "tier": return (a.tier - b.tier) * dir;
        default: return a.status.localeCompare(b.status) * dir;
      }
    });
  }, [entries, sortField, sortDirection, activeWaitlistSearch]);

  function formatDurationLabel(totalMinutes: number): string {
    if(totalMinutes <= 0) return "—";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if(hours > 0){
      parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    }
    if(minutes > 0){
      parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    }
    return parts.join(" ");
  }

  const openingDurationLabel = formatDurationLabel(
    timeToMinutes(openingEndTime) - timeToMinutes(openingStartTime),
  );

  const openingDurationError = getOpeningDurationError(openingStartTime, openingEndTime);
  const editingOpeningDurationError = editingOpening
    ? getOpeningDurationError(editingOpening.startTime, editingOpening.endTime)
    : "";
  const waitlistAvailabilityError = getAvailabilityRangeError(waitlistAvailableTimeRanges);
  const editingEntryAvailabilityError = editingEntry
    ? getAvailabilityRangeError(editingEntry.availableTimes.map((range, index) => rangeToDraft(range, index + 1)))
    : "";
  const waitlistInitials = (waitlistFirstName[0] ?? "") + (waitlistLastName[0] ?? "");

  // Derive whether the add-opening form has enough valid info to submit
  const canAddOpening =
    Boolean(openingProvider) &&
    Boolean(openingDate) &&
    Boolean(openingStartTime) &&
    Boolean(openingEndTime) &&
    !openingDurationError;

  // Derive whether the add-waitlist form has enough valid info to submit
  const canAddWaitlistEntry =
    Boolean(waitlistDateAdded) &&
    Boolean(waitlistLastName.trim()) &&
    Boolean(waitlistProvider) &&
    Boolean(waitlistReason.trim()) &&
    !waitlistAvailabilityError;

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — NAVIGATION & ACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  function goToPreviousWeek(){ setWeekStartDate(d => moveDateByDays(d, -7)); setSelectedOpeningId(null); }
  function goToNextWeek(){ setWeekStartDate(d => moveDateByDays(d,  7)); setSelectedOpeningId(null); }

  function openActionPage(){
    setActionMode(activeView === "WAITLIST" ? "WAITLIST_ENTRY" : "OPENING");
    setIsActionPageOpen(true);
  }

  function toggleSelectedOpeningSurgery(){
    if(!selectedOpening) return;
    setOpenings(prev => prev.map(opening =>
      opening.id === selectedOpening.id
        ? { ...opening, isSurgery: !isSurgeryOpening(opening) }
        : opening,
    ));
    setScheduleSelections({});
  }

  function clearImportPreview(){
    setImportPreviewRows([]);
    setImportFileName("");
    setImportError("");
    setIsImportDragOver(false);
    if(importFileInputRef.current) importFileInputRef.current.value = "";
  }

  function closeImportExportModal(){
    setIsImportExportModalOpen(false);
    clearImportPreview();
  }

  function handleImportFile(file: File | null){
    if(!file) return;
    // FIX: guard against unsupported file types early
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if(!["xlsx", "xls", "csv"].includes(ext)){
      setImportError("Unsupported file type. Please use .xlsx, .xls, or .csv.");
      return;
    }
    setImportError("");
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = event.target?.result;
        if(!data) throw new Error("Unable to read the selected file.");
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        if(!firstSheetName) throw new Error("The workbook does not contain a sheet.");
        const parsedRows = parseImportedWaitlistSheet(workbook.Sheets[firstSheetName]);
        const annotatedRows = annotateImportedProviders(parsedRows, providers);
        setImportPreviewRows(annotatedRows);
        if(annotatedRows.length === 0) setImportError("No waitlist rows were found in the first sheet.");
      } catch (error){
        setImportPreviewRows([]);
        setImportError(error instanceof Error ? error.message : "The file could not be imported.");
      }
    };
    reader.onerror = () => setImportError("The file could not be read.");
    reader.readAsArrayBuffer(file);
  }

  function confirmImportRows(){
    const rowsToImport = importPreviewRows.filter(row => row.status !== "ERROR");
    if(rowsToImport.length === 0) return;
    const providerNameByKey = new Map(providers.map(p => [p.name.trim().toLowerCase(), p.name]));
    const providersToAdd: Provider[] = [];
    for (const row of rowsToImport){
      const pName = row.provider.trim();
      const key = pName.toLowerCase();
      if(!key || providerNameByKey.has(key)) continue;
      providerNameByKey.set(key, pName);
      providersToAdd.push({
        name:  pName,
        color: IMPORT_PROVIDER_COLORS[(providers.length + providersToAdd.length) % IMPORT_PROVIDER_COLORS.length],
      });
    }
    let nextEntryId = getNextId(entries);
    const importedEntries: WaitlistEntry[] = rowsToImport.map(row => {
      const providerKey = row.provider.trim().toLowerCase();
      return {
        id: nextEntryId++,
        dateAdded: row.dateAdded,
        firstName: row.firstName,
        lastName: row.lastName,
        provider: providerNameByKey.get(providerKey) ?? row.provider.trim(),
        tier: row.tier,
        reason: row.reason,
        availableDays: row.availableDays,
        availableTimes: row.availableTimes,
        status: "WAITLISTED",
      };
    });
    if(providersToAdd.length > 0) setProviders(prev => [...prev, ...providersToAdd]);
    setEntries(prev => [...prev, ...importedEntries]);
    setActiveView("WAITLIST");
    setWaitlistHistoryPanel("ACTIVE");
    closeImportExportModal();
  }

  function exportWaitlistToExcel(){
    const rows = entries
      .filter(entry => entry.status === "WAITLISTED")
      .map(entry => ({
        "Date added": formatDateForExport(entry.dateAdded),
        Name: formatPersonName(entry.firstName, entry.lastName),
        Provider: entry.provider,
        Tier: entry.tier,
        Reason: entry.reason,
        Dates: entry.availableDays.join(","),
        Times: formatAvailableTimesForExport(entry.availableTimes),
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
  ){
    if(!selectedOpening) return;
    const entry = entries.find(e => e.id === entryId);
    if(!entry) return;

    const apptStart = timeToMinutes(appointmentStartTime);
    const apptEnd = timeToMinutes(appointmentEndTime);
    const openingStart = timeToMinutes(selectedOpening.startTime);
    const openingEnd = timeToMinutes(selectedOpening.endTime);
    const minimumMinutes = getMinimumAppointmentMinutes(selectedOpening);

    if(apptEnd - apptStart < minimumMinutes) return;
    if(apptStart < openingStart || apptEnd > openingEnd) return;
    if(!getEligibleScheduleWindows(entry, selectedOpening).some(
      w => apptStart >= w.start && apptEnd <= w.end)
    ) return;

    if(isAppointmentStartInPast(selectedOpening.date, appointmentStartTime)){
      const confirmed = window.confirm(
        `This appointment is in the past: ${formatDisplayDate(selectedOpening.date)} from ${formatTimeRange(appointmentStartTime, appointmentEndTime)}. Continue scheduling it for tracking purposes?`,
      );
      if(!confirmed) return;
    }

    setScheduledRecords(prev => [
      {
        id: getNextId(prev),
        entryId: entry.id,
        dateScheduled: toDateInputValue(new Date()),
        firstName: entry.firstName,
        lastName: entry.lastName,
        provider: entry.provider,
        tier: entry.tier,
        reason: entry.reason,
        status: "SCHEDULED",
        appointmentDate: selectedOpening.date,
        appointmentDay: selectedOpening.day,
        startTime: appointmentStartTime,
        endTime: appointmentEndTime,
      },
      ...prev,
    ]);
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, status: "SCHEDULED" } : e));
    setOpenings(prev => splitOpeningForAppointment(prev, selectedOpening.id, appointmentStartTime, appointmentEndTime));
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

  function addOpening(){
    if(!canAddOpening) return;
    const dayCode = getDayCodeFromDate(openingDate);
    if(!dayCode){
      alert("Openings can only be added on weekdays (Mon-Fri).");
      return;
    }
    if(isAppointmentStartInPast(openingDate, openingStartTime)){
      const confirmed = window.confirm(
        `This opening is in the past: ${formatDisplayDate(openingDate)} from ${formatTimeRange(openingStartTime, openingEndTime)}. Continue adding it for tracking purposes?`,
      );
      if(!confirmed) return;
    }
    const nextOpening: Opening = {
      id: getNextId(openings),
      provider: openingProvider,
      date: openingDate,
      day: dayCode,
      startTime: openingStartTime,
      endTime: openingEndTime,
      isSurgery: false,
    };
    setOpenings(prev => mergeSameProviderOpenings([...prev, nextOpening], nextOpening.id));
    setSelectedOpeningId(nextOpening.id);
  }

  function addProvider(){
    const cleanName = providerName.trim();
    if(!cleanName) return;
    if(providers.some(p => p.name.toLowerCase() === cleanName.toLowerCase())){
      // Duplicate error
      alert(`A provider named "${cleanName}" already exists.`);
      return;
    }
    setProviders(prev => [...prev, { name: cleanName, color: providerColor }]);
    setProviderName("");
    setProviderColor(DEFAULT_PROVIDER_COLOR);
  }

  function addWaitlistEntry(){
    if(!canAddWaitlistEntry) return;
    const firstName = waitlistFirstName.trim();
    const lastName = waitlistLastName.trim();
    const reason = waitlistReason.trim();
    const nextEntry: WaitlistEntry = {
      id: getNextId(entries),
      dateAdded: waitlistDateAdded,
      firstName,
      lastName,
      provider: waitlistProvider,
      tier: waitlistTier,
      reason,
      availableDays: waitlistAvailableDays,
      availableTimes: serializeTimeRangeDrafts(waitlistAvailableTimeRanges),
      status: "WAITLISTED",
    };
    setEntries(prev => [...prev, nextEntry]);
    resetWaitlistForm();
    setActiveView("WAITLIST");
    setIsActionPageOpen(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — EDIT SAVES
  // ─────────────────────────────────────────────────────────────────────────

  function saveEditingOpening(){
    if(!editingOpening) return;
    const durationError = getOpeningDurationError(editingOpening.startTime, editingOpening.endTime);
    if(durationError){
      alert(durationError);
      return;
    }
    const dayCode = getDayCodeFromDate(editingOpening.date);
    if(!dayCode){
      alert("Openings can only be saved on weekdays (Mon-Fri).");
      return;
    }
    if(isAppointmentStartInPast(editingOpening.date, editingOpening.startTime)){
      const confirmed = window.confirm(
        `This opening is in the past: ${formatDisplayDate(editingOpening.date)} from ${formatTimeRange(editingOpening.startTime, editingOpening.endTime)}. Continue saving it for tracking purposes?`,
      );
      if(!confirmed) return;
    }
    const { _original, ...cleanOpening } = editingOpening;
    void _original; // suppress unused-var lint
    setOpenings(prev =>
      mergeSameProviderOpenings(
        prev.map(o => o.id === cleanOpening.id
          ? { ...cleanOpening, day: dayCode }
          : o,
        ),
        cleanOpening.id,
      ),
    );
    setSelectedOpeningId(cleanOpening.id);
    setEditingOpening(null);
  }

  function saveEditingEntry(){
    if(!editingEntry) return;
    if(editingEntryAvailabilityError) return;
    // Guard against saving an entry with an empty last name
    if(!editingEntry.lastName.trim()){
      alert("Patient name cannot be empty.");
      return;
    }
    const normalizedEntry: WaitlistEntry = {
      ...editingEntry,
      firstName: editingEntry.firstName.trim(),
      lastName: editingEntry.lastName.trim(),
      reason: editingEntry.reason.trim(),
      availableTimes: serializeTimeRangeDrafts(
        editingEntry.availableTimes.map((range, index) => rangeToDraft(range, index + 1)),
      ),
    };
    setEntries(prev => prev.map(e => e.id === normalizedEntry.id ? normalizedEntry : e));
    setEditingEntry(null);
  }

  function saveEditingProvider(){
    if(!editingProvider) return;
    const oldName = editingProvider._originalName ?? editingProvider.name;
    const newName = editingProvider.name.trim();
    if(!newName){
      alert("Provider name cannot be empty.");
      return;
    }
    const duplicateProvider = providers.some(
      p => p.name !== oldName && p.name.trim().toLowerCase() === newName.toLowerCase(),
    );
    if(duplicateProvider){
      alert("A provider with that name already exists.");
      return;
    }
    setProviders(prev => prev.map(p => p.name === oldName ? { name: newName, color: editingProvider.color } : p));
    if(oldName !== newName){
      setOpenings(prev => prev.map(o => o.provider === oldName ? { ...o, provider: newName } : o));
      setEntries(prev  => prev.map(e => e.provider === oldName ? { ...e, provider: newName } : e));
      setScheduledRecords(prev => prev.map(r => r.provider === oldName ? { ...r, provider: newName } : r));
      setRemovedRecords(prev   => prev.map(r => r.provider === oldName ? { ...r, provider: newName } : r));
    }
    setEditingProvider(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — REMOVALS
  // ─────────────────────────────────────────────────────────────────────────

  function requestRemoveEntry(entry: WaitlistEntry){
    setPendingRemoval({
      type: "ENTRY",
      id: entry.id,
      title: "Remove waitlist entry?",
      message: `This will remove ${getFullName(entry)} from the active waitlist.`,
      confirmLabel: "Remove Entry",
    });
  }

  function requestRemoveOpening(opening: Opening){
    setPendingRemoval({
      type: "OPENING",
      id: opening.id,
      title: "Remove opening?",
      message: `This will delete the ${opening.provider} opening on ${formatDisplayDate(opening.date)} from ${formatTimeRange(opening.startTime, opening.endTime)}.`,
      confirmLabel: "Remove Opening",
    });
  }

  function requestDeleteScheduledRecord(record: ScheduledRecord){
    setPendingRemoval({
      type: "SCHEDULED_RECORD",
      id: record.id,
      entryId: record.entryId,
      title: "Delete scheduled record?",
      message: `This will permanently delete the scheduled record for ${formatPersonName(record.firstName, record.lastName)}.`,
      confirmLabel: "Delete Record",
    });
  }

  function requestDeleteRemovedRecord(record: RemovedRecord){
    setPendingRemoval({
      type: "REMOVED_RECORD",
      id: record.id,
      entryId: record.entryId,
      title: "Delete removed record?",
      message: `This will permanently delete the removed record for ${formatPersonName(record.firstName, record.lastName)}.`,
      confirmLabel: "Delete Record",
    });
  }

  function requestRemoveProvider(provider: Provider){
    const waitlistedPatientCount = entries.filter(e => e.provider === provider.name && e.status === "WAITLISTED").length;
    const scheduledPatientCount = scheduledRecords.filter(r => r.provider === provider.name).length;
    const removedPatientCount = removedRecords.filter(r => r.provider === provider.name).length;
    const totalPatientReferences = waitlistedPatientCount + scheduledPatientCount + removedPatientCount;
    if(totalPatientReferences > 0){
      alert(
        `Cannot remove ${provider.name} because ${totalPatientReferences} patient record(s) still reference this provider. ` +
        `Active waitlist: ${waitlistedPatientCount}. Scheduled history: ${scheduledPatientCount}. Removed history: ${removedPatientCount}. ` +
        "Rename the provider instead, or move/delete those patient records first.",
      );
      return;
    }
    setPendingRemoval({
      type: "PROVIDER",
      name: provider.name,
      title: "Remove provider?",
      message: `This will remove ${provider.name} and delete all of their current openings. No patient records reference this provider.`,
      confirmLabel: "Remove Provider",
    });
  }

  function confirmPendingRemoval(){
    if(!pendingRemoval) return;
    switch (pendingRemoval.type){
      case "ENTRY": {
        const removedEntry = entries.find(e => e.id === pendingRemoval.id);
        if(removedEntry){
          setRemovedRecords(prev => [{
            id: getNextId(prev),
            entryId: removedEntry.id,
            dateRemoved: toDateInputValue(new Date()),
            dateAdded: removedEntry.dateAdded,
            firstName: removedEntry.firstName,
            lastName: removedEntry.lastName,
            provider: removedEntry.provider,
            tier: removedEntry.tier,
            reason: removedEntry.reason,
            status: "REMOVED",
          }, ...prev]);
        }
        setEntries(prev => prev.map(e => e.id === pendingRemoval.id ? { ...e, status: "REMOVED" } : e));
        break;
      }
      case "OPENING": {
        setOpenings(prev => prev.filter(o => o.id !== pendingRemoval.id));
        if(selectedOpeningId === pendingRemoval.id) setSelectedOpeningId(null);
        break;
      }
      case "SCHEDULED_RECORD": {
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
        if(openingProvider  === removedName) setOpeningProvider(fallback);
        if(waitlistProvider === removedName) setWaitlistProvider(fallback);
        break;
      }
    }
    setPendingRemoval(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONS — AVAILABILITY / TIME RANGE FORM HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  function toggleWaitlistAvailableDay(day: DayCode){
    setWaitlistAvailableDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day],
    );
  }

  function addWaitlistAvailableTimeRange(){
    setWaitlistAvailableTimeRanges(prev => {
      const nextRange = getNextAvailableTimeRangeDraft(prev);
      return nextRange ? [...prev, nextRange] : prev;
    });
  }

  function updateWaitlistAvailableTimeRange(id: number, field: "startTime" | "endTime", value: string){
    setWaitlistAvailableTimeRanges(prev =>
      prev.map(r => r.id === id ? { ...r, [field]: value } : r),
    );
  }

  function removeWaitlistAvailableTimeRange(id: number){
    setWaitlistAvailableTimeRanges(prev => prev.filter(r => r.id !== id));
  }

  function addEditingEntryTimeRange(){
    if(!editingEntry) return;
    const drafts = editingEntry.availableTimes.map((range, index) => rangeToDraft(range, index + 1));
    const nextRange = getNextAvailableTimeRangeDraft(drafts);
    if(!nextRange) return;
    setEditingEntry({
      ...editingEntry,
      availableTimes: serializeTimeRangeDrafts([...drafts, nextRange]),
    });
  }

  function updateEditingEntryTimeRange(index: number, field: "startTime" | "endTime", value: string){
    if(!editingEntry) return;
    const ranges = editingEntry.availableTimes.map(rangeToDraft);
    ranges[index] = { ...ranges[index], [field]: value };
    setEditingEntry({
      ...editingEntry,
      availableTimes: ranges.map(range => `${range.startTime}-${range.endTime}`),
    });
  }

  function removeEditingEntryTimeRange(index: number){
    if(!editingEntry) return;
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
  ){
    const minimumMinutes = getMinimumAppointmentMinutes(opening);
    const current = getResolvedScheduleSelection(entry, opening, scheduleSelections[entryId]);
    const windows = getEligibleScheduleWindows(entry, opening);
    const next = normalizeScheduleSelection({ ...current, [field]: value }, field, windows, minimumMinutes);
    setScheduleSelections(prev => ({ ...prev, [entryId]: next }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FORM RESET
  // ─────────────────────────────────────────────────────────────────────────

  function resetWaitlistForm(){
    setWaitlistFirstName("");
    setWaitlistLastName("");
    setWaitlistTier(1);
    setWaitlistReason(getTierReason(1));
    setWaitlistAvailableDays([]);
    setWaitlistAvailableTimeRanges([]);
  }

  async function exportDatabaseBackup(){
    if(!window.appStorage){
      setStorageError("Database backups are only available in the desktop app.");
      return;
    }
    setIsStorageBusy(true);
    setStorageError("");
    setStorageMessage("");
    try {
      await saveCurrentStateToStorage();
      const result = await window.appStorage.exportBackup();
      if(result.canceled){
        setStorageMessage("Backup export canceled.");
      } else {
        setStorageMessage(result.filePath ? `Backup exported to ${result.filePath}.` : "Backup exported.");
      }
    } catch (error){
      console.error("Failed to export database backup:", error);
      setStorageError("Backup export failed.");
    } finally {
      setIsStorageBusy(false);
    }
  }

  async function importDatabaseBackup(){
    if(!window.appStorage){
      setStorageError("Database backups are only available in the desktop app.");
      return;
    }
    const confirmed = window.confirm(
      "Import a database backup? This will replace all current providers, openings, waitlist entries, scheduled records, and removed records.",
    );
    if(!confirmed) return;
    setIsStorageBusy(true);
    setStorageError("");
    setStorageMessage("");
    try {
      const importedState = await window.appStorage.importBackup();
      if(!importedState){
        setStorageMessage("Backup import canceled.");
        return;
      }
      applyPersistedAppState(importedState);
      setHasLoadedStorage(true);
      setStorageMessage("Backup imported and applied.");
    } catch (error){
      console.error("Failed to import database backup:", error);
      setStorageError("Backup import failed.");
    } finally {
      setIsStorageBusy(false);
    }
  }

  async function restoreLatestDatabaseBackup(){
    if(!window.appStorage){
      setStorageError("Database backups are only available in the desktop app.");
      return;
    }
    const confirmed = window.confirm(
      "Restore the latest automatic backup? This will replace the current database state.",
    );
    if(!confirmed) return;
    setIsStorageBusy(true);
    setStorageError("");
    setStorageMessage("");
    try {
      const restoredState = await window.appStorage.restoreLatestBackup();
      if(!restoredState){
        setStorageMessage("No automatic backup was found.");
        return;
      }
      applyPersistedAppState(restoredState);
      setHasLoadedStorage(true);
      setStorageMessage("Latest automatic backup restored.");
    } catch (error){
      console.error("Failed to restore latest backup:", error);
      setStorageError("Backup restore failed. Check the console for details.");
    } finally {
      setIsStorageBusy(false);
    }
  }

  async function openDatabaseBackupFolder(){
    if(!window.appStorage){
      setStorageError("Database backups are only available in the desktop app.");
      return;
    }
    setIsStorageBusy(true);
    setStorageError("");
    setStorageMessage("");
    try {
      const result = await window.appStorage.openBackupFolder();
      if(result.opened){
        setStorageMessage("Backup folder opened.");
      } else {
        setStorageError(result.error ?? "Backup folder could not be opened.");
      }
    } catch (error){
      console.error("Failed to open backup folder:", error);
      setStorageError("Backup folder could not be opened.");
    } finally {
      setIsStorageBusy(false);
    }
  }

  async function resetDatabase(){
    const confirmed = window.confirm(
      "Reset the database? This will permanently delete all providers, openings, waitlist entries, scheduled records, and removed records.",
    );
    if(!confirmed) return;
    setIsStorageBusy(true);
    setStorageError("");
    setStorageMessage("");
    try {
      if(window.appStorage) await window.appStorage.reset();
      clearCurrentAppState();
      setHasLoadedStorage(true);
      setStorageMessage("Database reset. A backup was created before reset when saved data existed.");
    } catch (error){
      console.error("Failed to reset database:", error);
      setStorageError("Database reset failed.");
    } finally {
      setIsStorageBusy(false);
    }
  }

  async function clearOldDatabaseBackups(){
    if(!window.appStorage){
      setStorageError("Backup cleanup is only available in the desktop app.");
      return;
    }
    const confirmed = window.confirm(
      "Clear old automatic backups? This keeps the newest 50 automatic backups and removes automatic backups older than one year.",
    );
    if(!confirmed) return;
    setIsStorageBusy(true);
    setStorageError("");
    setStorageMessage("");
    try {
      const result = await window.appStorage.clearOldBackups();
      setStorageMessage(
        `Old backup cleanup complete. Deleted ${result.deletedCount} backup${result.deletedCount === 1 ? "" : "s"}. Kept ${result.keptCount}.`,
      );
    } catch (error){
      console.error("Failed to clear old backups:", error);
      setStorageError("Old backup cleanup failed.");
    } finally {
      setIsStorageBusy(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD SHORTCUTS
  // ─────────────────────────────────────────────────────────────────────────

  // Escape closes any open modal or action page
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent){
      if(e.key !== "Escape") return;
      // Close modals/overlays in priority order
      if(pendingRemoval){ setPendingRemoval(null); return; }
      if(reasonPreview){ setReasonPreview(null); return; }
      if(editingOpening){ setEditingOpening(null); return; }
      if(editingEntry){ setEditingEntry(null); return; }
      if(editingProvider){ setEditingProvider(null); return; }
      if(isSettingsModalOpen){ setIsSettingsModalOpen(false); return; }
      if(isImportExportModalOpen){ closeImportExportModal(); return; }
      if(isActionPageOpen){ setIsActionPageOpen(false); return; }
      // Deselect opening
      if(selectedOpeningId !== null){ setSelectedOpeningId(null); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingRemoval, reasonPreview, editingOpening, editingEntry,
    editingProvider, isSettingsModalOpen, isImportExportModalOpen,
    isActionPageOpen, selectedOpeningId,
  ]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  function renderReasonCell(reason: string, title = "Reason"){
    const text = reason.trim() || "—";
    return (
      <button
        type="button"
        className="reason-preview-button"
        title={text}
        onClick={() => setReasonPreview({ title, text })}
      >
        {text}
      </button>
    );
  }

  function renderScheduledRecordsTable(records: ScheduledRecord[]){
    return (
      <div className="table-scroll history-table-scroll">
        <table className="history-table scheduled-table">
          <colgroup>
            <col className="scheduled-col-date" />
            <col className="scheduled-col-name" />
            <col className="scheduled-col-provider" />
            <col className="scheduled-col-tier" />
            <col className="scheduled-col-status" />
            <col className="scheduled-col-appointment" />
            <col className="scheduled-col-time" />
            <col className="scheduled-col-reason" />
            <col className="scheduled-col-actions" />
          </colgroup>
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
                <td className="truncate-cell" title={formatPersonName(record.firstName, record.lastName)}>
                  {formatPersonName(record.firstName, record.lastName)}
                </td>
                <td className="truncate-cell" title={record.provider}>{record.provider}</td>
                <td><span className={`tier-badge tier-${record.tier}`}>Tier {record.tier}</span></td>
                <td>{record.status}</td>
                <td>{record.appointmentDay} · {formatDisplayDate(record.appointmentDate)}</td>
                <td>{formatTimeRange(record.startTime, record.endTime)}</td>
                <td className="reason-cell">{renderReasonCell(record.reason, `Reason for ${formatPersonName(record.firstName, record.lastName)}`)}</td>
                <td>
                  <button className="remove-button" onClick={() => requestDeleteScheduledRecord(record)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const cornerActionLabel = activeView === "WAITLIST" ? "+ Add to Waitlist" : "+ Add Opening";
  const storageApiAvailable = Boolean(window.appStorage);

  // FIX: no providers yet — show a friendly empty state on the calendar
  const hasNoProviders = providers.length === 0;

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
          <button
            className="settings-icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => setIsSettingsModalOpen(true)}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-.4-1.1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.06a1.7 1.7 0 0 0 1.1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 .4 1.1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 9c.24.35.38.74.4 1.15H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.1.4 1.7 1.7 0 0 0-.44.45Z" />
            </svg>
          </button>
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
            {hasNoProviders ? (
              <p className="empty-message" style={{ fontSize: 12, textAlign: "center", marginTop: 8 }}>
                No providers yet.
              </p>
            ) : (
              <div className="provider-list">
                {providers.map(p => (
                  <div className="provider-key" key={p.name}>
                    <span>{p.name}</span>
                    <span className="provider-color" style={{ backgroundColor: p.color }} />
                  </div>
                ))}
              </div>
            )}
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
              <button className="arrow-button" onClick={goToPreviousWeek} aria-label="Previous week">←</button>
              <h1>Week of {formatDisplayDate(weekStartDate)}</h1>
              <button className="arrow-button" onClick={goToNextWeek} aria-label="Next week">→</button>
            </div>
            {/* FIX: show a nudge when there are no providers */}
            {hasNoProviders && (
              <div className="calendar-empty-nudge">
                <span>Add providers to get started.</span>
                <button
                  className="btn-primary"
                  style={{ fontSize: 12, padding: "5px 14px" }}
                  onClick={() => { setActionMode("EDIT_PROVIDERS"); setIsActionPageOpen(true); }}
                >
                  Edit Providers
                </button>
              </div>
            )}
            <div className="calendar-grid">
              {weekDates.map(day => {
                const dayOpenings = openings.filter(o => o.date === day.dateString);
                const openingSegments = buildOpeningSegments(dayOpenings);
                const isToday = day.dateString === todayDateString;
                return (
                  <div className={["day-column", isToday ? "today-column" : ""].join(" ")} key={day.dateString}>
                    <div className={["day-header", isToday ? "today-header" : ""].join(" ")}>
                      <span>{day.label}</span>
                      <strong>{day.date.getDate()}</strong>
                      {isToday && <em>Today</em>}
                    </div>
                    <div className="day-body">
                      {TIME_SLOT_LABELS.map(time => (
                        <div className="time-row" key={time}>
                          <span>{formatDisplayTime(time)}</span>
                        </div>
                      ))}
                      {openingSegments.map(segment => {
                        const color = providers.find(p => p.name === segment.opening.provider)?.color ?? "#999";
                        const isDragging = draggingId === segment.opening.id;
                        const opening = openings.find(o => o.id === segment.opening.id) ?? segment.opening;
                        return (
                          <div
                            key={`${segment.opening.id}-${segment.startTime}-${segment.index}`}
                            className={[
                              "opening-block",
                              selectedOpeningId === segment.opening.id ? "selected" : "",
                              hoveredOpeningId === segment.opening.id ? "opening-hovered" : "",
                              segment.isFirstPiece ? "first-piece" : "",
                              segment.isLastPiece ? "last-piece" : "",
                              isDragging ? "is-dragging" : "",
                              calendarLocked ? "is-locked" : "is-draggable",
                            ].join(" ")}
                            style={{
                              backgroundColor: color,
                              top: isDragging ? `${getOpeningTopPct(opening.startTime)}%` : `${getOpeningTopPct(segment.startTime)}%`,
                              height: isDragging ? `${getOpeningHeightPct(opening.startTime, opening.endTime)}%` : `${getOpeningHeightPct(segment.startTime, segment.endTime)}%`,
                              left: segment.left,
                              width: segment.width,
                              right: "auto",
                            }}
                            onClick={() => { if(!isDragging) setSelectedOpeningId(segment.opening.id); }}
                            onMouseEnter={() => setHoveredOpeningId(segment.opening.id)}
                            onMouseLeave={() => setHoveredOpeningId(null)}
                          >
                            {!calendarLocked && segment.isFirstPiece && (
                              <div
                                className="resize-handle resize-top"
                                onPointerDown={e => {
                                  const col = e.currentTarget.closest(".day-body") as HTMLElement | null;
                                  startDrag(e, opening, "resize-top", col?.getBoundingClientRect().height ?? 600);
                                }}
                              />
                            )}
                            <div
                              className="opening-move-area"
                              onPointerDown={e => {
                                const col = e.currentTarget.closest(".day-body") as HTMLElement | null;
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
                            {segment.showLabel && (
                              <button
                                className="opening-edit-btn"
                                title="Edit opening"
                                onClick={e => { e.stopPropagation(); setEditingOpening({ ...opening, _original: opening }); }}
                              >
                                ✎
                              </button>
                            )}
                            {!calendarLocked && segment.isLastPiece && (
                              <div
                                className="resize-handle resize-bottom"
                                onPointerDown={e => {
                                  const col = e.currentTarget.closest(".day-body") as HTMLElement | null;
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
                  <button
                    type="button"
                    className={isSurgeryOpening(selectedOpening) ? "surgery-pill-button active" : "surgery-pill-button"}
                    aria-pressed={isSurgeryOpening(selectedOpening)}
                    title={isSurgeryOpening(selectedOpening) ? "Surgery timing is on" : "Surgery timing is off"}
                    onClick={toggleSelectedOpeningSurgery}
                  >
                    Surgery
                  </button>
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
                      if(!selectedOpening) return null;
                      const minimumMinutes = getMinimumAppointmentMinutes(selectedOpening);
                      const windows      = getEligibleScheduleWindows(entry, selectedOpening);
                      const selection    = getResolvedScheduleSelection(entry, selectedOpening, scheduleSelections[entry.id]);
                      const startOptions = getScheduleStartOptions(windows, minimumMinutes);
                      const endOptions   = getScheduleEndOptions(windows, selection.startTime, minimumMinutes);

                      // FIX: guard against empty option sets that would render empty selects
                      if(startOptions.length === 0 || endOptions.length === 0) return null;

                      return (
                        <article className="eligible-card" key={entry.id}>
                          <div className="eligible-card-top">
                            <div className="eligible-name-block">
                              <div className="eligible-name-row">
                                <h4 className="eligible-patient-name">{getFullName(entry)}</h4>
                                <span className="eligible-date-added">
                                  Added {formatDateForExport(entry.dateAdded)}
                                </span>
                              </div>
                              <span className={`tier-badge tier-${entry.tier}`}>
                                Tier {entry.tier}
                              </span>
                            </div>
                            <button
                              className="eligible-schedule-button"
                              onClick={() =>
                                scheduleEntryForSelectedOpening(
                                  entry.id,
                                  selection.startTime,
                                  selection.endTime
                                )
                              }
                            >
                              Schedule
                            </button>
                          </div>
                          <div className="eligible-schedule-row">
                            <label>
                              <span>Start</span>
                              <select
                                value={selection.startTime}
                                onChange={e =>
                                  updateScheduleSelection(
                                    entry.id,
                                    "startTime",
                                    e.target.value,
                                    entry,
                                    selectedOpening
                                  )
                                }
                              >
                                {startOptions.map(t => (
                                  <option key={t} value={t}>
                                    {formatDisplayTime(t)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>End</span>
                              <select
                                value={selection.endTime}
                                onChange={e =>
                                  updateScheduleSelection(
                                    entry.id,
                                    "endTime",
                                    e.target.value,
                                    entry,
                                    selectedOpening
                                  )
                                }
                              >
                                {endOptions.map(t => (
                                  <option key={t} value={t}>
                                    {formatDisplayTime(t)}
                                  </option>
                                ))}
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

      {/* WAITLIST VIEW */}
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
            <>
              <div className="section-search-row">
                <label className="section-search-field">
                  <span className="field-label-text">Search waitlist</span>
                  <input
                    type="search"
                    value={activeWaitlistSearch}
                    onChange={e => setActiveWaitlistSearch(e.target.value)}
                    placeholder="Search by patient, provider, reason, tier, status, or availability"
                  />
                </label>
                <span className="section-search-count">
                  {sortedWaitlistEntries.length} of {waitlistedCount} shown
                </span>
              </div>
              {sortedWaitlistEntries.length === 0 ? (
                <p className="empty-message">
                  {waitlistedCount === 0 ? "No patients are on the active waitlist." : "No active waitlist patients match this search."}
                </p>
              ) : (
                <div className="table-scroll waitlist-table-scroll">
                  <table className="waitlist-table">
                    <colgroup>
                      <col className="waitlist-col-date" />
                      <col className="waitlist-col-name" />
                      <col className="waitlist-col-provider" />
                      <col className="waitlist-col-tier" />
                      <col className="waitlist-col-reason" />
                      <col className="waitlist-col-days" />
                      <col className="waitlist-col-times" />
                      <col className="waitlist-col-status" />
                      <col className="waitlist-col-actions" />
                    </colgroup>
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
                          <td className="reason-cell">{renderReasonCell(entry.reason, `Reason for ${getFullName(entry)}`)}</td>
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
                </div>
              )}
            </>
          )}

          {/* Scheduled history */}
          {waitlistHistoryPanel === "SCHEDULED" && (
            scheduledRecords.length === 0 ? (
              <p className="empty-message">No patients have been scheduled yet.</p>
            ) : (
              <>
                <div className="section-search-row">
                  <label className="section-search-field">
                    <span className="field-label-text">Search scheduled</span>
                    <input
                      type="search"
                      value={scheduledSearch}
                      onChange={e => setScheduledSearch(e.target.value)}
                      placeholder="Search by patient, provider, appointment date, reason, tier, or status"
                    />
                  </label>
                  <span className="section-search-count">
                    {filteredScheduledRecords.length} of {scheduledRecords.length} shown
                  </span>
                </div>
                {filteredScheduledRecords.length === 0 ? (
                  <p className="empty-message">No scheduled patients match this search.</p>
                ) : (
                  <div className="history-section-stack">
                    <section className="history-section">
                      <div className="history-section-header">
                        <h2 className="history-section-title">Scheduled</h2>
                        <span className="items-count">{upcomingScheduledRecords.length}</span>
                      </div>
                      {upcomingScheduledRecords.length === 0
                        ? <p className="empty-message">No upcoming scheduled patients match this search.</p>
                        : renderScheduledRecordsTable(upcomingScheduledRecords)
                      }
                    </section>
                    <section className="history-section">
                      <div className="history-section-header">
                        <h2 className="history-section-title">Past Scheduled</h2>
                        <span className="items-count">{pastScheduledRecords.length}</span>
                      </div>
                      {pastScheduledRecords.length === 0
                        ? <p className="empty-message">No past scheduled patients match this search.</p>
                        : renderScheduledRecordsTable(pastScheduledRecords)
                      }
                    </section>
                  </div>
                )}
              </>
            )
          )}

          {/* Removed history */}
          {waitlistHistoryPanel === "REMOVED" && (
            removedRecords.length === 0 ? (
              <p className="empty-message">No patients have been removed recently.</p>
            ) : (
              <>
                <div className="section-search-row">
                  <label className="section-search-field">
                    <span className="field-label-text">Search removed</span>
                    <input
                      type="search"
                      value={removedSearch}
                      onChange={e => setRemovedSearch(e.target.value)}
                      placeholder="Search by patient, provider, removal date, reason, tier, or status"
                    />
                  </label>
                  <span className="section-search-count">
                    {filteredRemovedRecords.length} of {removedRecords.length} shown
                  </span>
                </div>
                {filteredRemovedRecords.length === 0 ? (
                  <p className="empty-message">No removed patients match this search.</p>
                ) : (
                  <div className="table-scroll history-table-scroll">
                    <table className="history-table removed-table">
                      <colgroup>
                        <col className="removed-col-date" />
                        <col className="removed-col-name" />
                        <col className="removed-col-provider" />
                        <col className="removed-col-tier" />
                        <col className="removed-col-status" />
                        <col className="removed-col-added" />
                        <col className="removed-col-reason" />
                        <col className="removed-col-actions" />
                      </colgroup>
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
                        {filteredRemovedRecords.map(record => (
                          <tr key={record.id}>
                            <td>{record.dateRemoved}</td>
                            <td className="truncate-cell" title={formatPersonName(record.firstName, record.lastName)}>
                              {formatPersonName(record.firstName, record.lastName)}
                            </td>
                            <td className="truncate-cell" title={record.provider}>{record.provider}</td>
                            <td><span className={`tier-badge tier-${record.tier}`}>Tier {record.tier}</span></td>
                            <td>{record.status}</td>
                            <td>{record.dateAdded}</td>
                            <td className="reason-cell">{renderReasonCell(record.reason, `Reason for ${formatPersonName(record.firstName, record.lastName)}`)}</td>
                            <td>
                              <button className="remove-button" onClick={() => requestDeleteRemovedRecord(record)}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )
          )}
        </section>
      )}

      {/* ACTION PAGES */}
      {isActionPageOpen && (
        <section className="action-page">
          {/* ADD OPENING */}
          {actionMode === "OPENING" && (
            <>
              <div className="action-header-row">
                <div>
                  <h1 className="action-page-title">Add Opening</h1>
                </div>
                <button className="close-action-button" aria-label="Close" onClick={() => setIsActionPageOpen(false)}>×</button>
              </div>
              {/* FIX: surface a clear message when there are no providers */}
              {hasNoProviders ? (
                <div className="action-no-providers-notice">
                  <p>You need at least one provider before adding openings.</p>
                  <button
                    className="btn-primary"
                    onClick={() => setActionMode("EDIT_PROVIDERS")}
                  >
                    Add a Provider
                  </button>
                </div>
              ) : (
                <>
                  <div className="form-section-label">Opening details</div>
                  {openingDurationError && <p className="form-error-text">{openingDurationError}</p>}
                  <div className="form-row" style={{ marginBottom: 16 }}>
                    <label className="field-label-block">
                      <span className="field-label-text">Provider</span>
                      <select value={openingProvider} onChange={e => setOpeningProvider(e.target.value)}>
                        {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                    </label>
                    <label className="field-label-block opening-date-field">
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
                    <button
                      className="btn-primary"
                      disabled={!canAddOpening}
                      onClick={addOpening}
                    >
                      + Add Opening
                    </button>
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
                          <span className="item-dot" style={{ backgroundColor: color }} />
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
            </>
          )}

          {/* EDIT PROVIDERS */}
          {actionMode === "EDIT_PROVIDERS" && (
            <>
              <div className="action-header-row">
                <div><h1 className="action-page-title">Edit Providers</h1></div>
                <button className="close-action-button" aria-label="Close" onClick={() => setIsActionPageOpen(false)}>×</button>
              </div>
              <div className="form-section-label">Add provider</div>
              <div className="form-row" style={{ marginBottom: 24, alignItems: "flex-end" }}>
                <label className="field-label-block field-grow">
                  <span className="field-label-text">Provider name</span>
                  <input
                    value={providerName}
                    onChange={e => setProviderName(e.target.value)}
                    placeholder="Name"
                    // FIX: allow Enter key to submit add-provider form
                    onKeyDown={e => { if(e.key === "Enter") addProvider(); }}
                  />
                </label>
                <label className="field-label-block">
                  <span className="field-label-text">Calendar color</span>
                  <div className="color-field-row">
                    <span className="color-swatch" style={{ backgroundColor: providerColor }} />
                    <input type="color" value={providerColor} onChange={e => setProviderColor(e.target.value)} style={{ flex: 1 }} />
                  </div>
                </label>
                <button className="btn-primary" disabled={!providerName.trim()} onClick={addProvider} style={{ alignSelf: "flex-end" }}>
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
                {providers.length === 0 && (
                  <p className="empty-message">No providers added yet.</p>
                )}
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
                </div>
                <button className="close-action-button" aria-label="Close" onClick={() => setIsActionPageOpen(false)}>×</button>
              </div>
              {/* FIX: warn when no providers exist */}
              {hasNoProviders && (
                <div className="action-no-providers-notice">
                  <p>You need at least one provider before adding waitlist entries.</p>
                  <button
                    className="btn-primary"
                    onClick={() => { setActionMode("EDIT_PROVIDERS"); }}
                  >
                    Add a Provider
                  </button>
                </div>
              )}
              <div className="form-section-label">Patient</div>
              <div className="form-row" style={{ marginBottom: 16 }}>
                <label className="field-label-block opening-date-field">
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
                  <select value={waitlistProvider} onChange={e => setWaitlistProvider(e.target.value)} disabled={hasNoProviders}>
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
                {waitlistAvailabilityError && <p className="form-error-text compact-error">{waitlistAvailabilityError}</p>}
                {waitlistAvailableTimeRanges.length === 0 ? (
                  <p className="field-hint">No time ranges inputted to indicate any time.</p>
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
              </div>
              <div className="form-submit-row">
                <button className="btn-secondary" onClick={() => setIsActionPageOpen(false)}>Cancel</button>
                <button
                  className="btn-primary"
                  disabled={!canAddWaitlistEntry}
                  onClick={addWaitlistEntry}
                >
                  + Add to Waitlist
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* IMPORT / EXPORT MODAL */}
      {isImportExportModalOpen && (
        <div className="modal-backdrop" onClick={closeImportExportModal}>
          <div className="modal-box modal-xl import-export-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Import / Export Waitlist</h2>
                <p className="modal-subtitle">Expected columns: Date added, Name, Provider, Tier, Reason, Dates, Times.</p>
              </div>
              <button className="close-action-button" aria-label="Close" onClick={closeImportExportModal}>×</button>
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
                  <p>Downloads the current waitlisted patients.</p>
                </div>
                {/* FIX: disable export when there are no waitlisted patients */}
                <button
                  className="btn-primary"
                  disabled={waitlistedCount === 0}
                  onClick={exportWaitlistToExcel}
                  title={waitlistedCount === 0 ? "No patients on the active waitlist" : undefined}
                >
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
                          <td className="reason-cell">{row.messages.length > 0 ? row.messages.join(" ") : "Ready to import."}</td>
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

      {/* SETTINGS MODAL */}
      {isSettingsModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsSettingsModalOpen(false)}>
          <div className="modal-box settings-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Settings</h2>
              <button className="close-action-button" aria-label="Close" onClick={() => setIsSettingsModalOpen(false)}>×</button>
            </div>
            <div className="settings-stack">
              <section className="settings-section">
                <div>
                  <h3>Database backups</h3>
                  <p>
                    Export, import, restore, or open the full database backup folder.
                  </p>
                  {!storageApiAvailable && (
                    <p className="settings-inline-warning">
                      Database backups are only available in the packaged Electron app.
                    </p>
                  )}
                </div>
                <div className="settings-button-column">
                  <button
                    className="btn-primary"
                    disabled={isStorageBusy || !storageApiAvailable}
                    onClick={exportDatabaseBackup}
                  >
                    Export Backup
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={isStorageBusy || !storageApiAvailable}
                    onClick={importDatabaseBackup}
                  >
                    Import Backup
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={isStorageBusy || !storageApiAvailable}
                    onClick={restoreLatestDatabaseBackup}
                  >
                    Restore Latest
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={isStorageBusy || !storageApiAvailable}
                    onClick={openDatabaseBackupFolder}
                  >
                    Open Backup Folder
                  </button>
                </div>
              </section>
              <section className="settings-section settings-danger-zone">
                <div>
                  <h3>Danger zone</h3>
                  <p>
                    Clear old automatic backups or reset the full local database. Backup cleanup keeps
                    the newest 50 automatic backups and removes automatic backups older than one year.
                  </p>
                </div>
                <div className="settings-button-column">
                  <button
                    className="btn-danger-secondary"
                    disabled={isStorageBusy || !storageApiAvailable}
                    onClick={clearOldDatabaseBackups}
                  >
                    Clear Old Backups
                  </button>
                  <button
                    className="btn-danger"
                    disabled={isStorageBusy}
                    onClick={resetDatabase}
                  >
                    Reset Database
                  </button>
                </div>
              </section>
              {(storageMessage || storageError) && (
                <div className={storageError ? "settings-status settings-status-error" : "settings-status"}>
                  {storageError || storageMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM REMOVAL MODAL */}
      {pendingRemoval && (
        <div className="modal-backdrop" onClick={() => setPendingRemoval(null)}>
          <div className="modal-box confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{pendingRemoval.title}</h2>
              <button className="close-action-button" aria-label="Close" onClick={() => setPendingRemoval(null)}>×</button>
            </div>
            <p className="confirm-message">{pendingRemoval.message}</p>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setPendingRemoval(null)}>Cancel</button>
              <button className="btn-danger"    onClick={confirmPendingRemoval}>{pendingRemoval.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}

      {reasonPreview && (
        <div className="modal-backdrop" onClick={() => setReasonPreview(null)}>
          <div className="modal-box reason-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{reasonPreview.title}</h2>
              <button className="close-action-button" aria-label="Close" onClick={() => setReasonPreview(null)}>×</button>
            </div>
            <div className="reason-modal-text">{reasonPreview.text}</div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setReasonPreview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT OPENING MODAL */}
      {editingOpening && (
        <div className="modal-backdrop" onClick={() => setEditingOpening(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Opening</h2>
              <button className="close-action-button" aria-label="Close" onClick={() => setEditingOpening(null)}>×</button>
            </div>
            {editingOpeningDurationError && <p className="form-error-text">{editingOpeningDurationError}</p>}
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
              <label className="field-label-block opening-date-field">
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
              <button className="btn-primary" disabled={Boolean(editingOpeningDurationError)} onClick={saveEditingOpening}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT ENTRY MODAL */}
      {editingEntry && (
        <div className="modal-backdrop" onClick={() => setEditingEntry(null)}>
          <div className="modal-box modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Waitlist Entry</h2>
              <button className="close-action-button" aria-label="Close" onClick={() => setEditingEntry(null)}>×</button>
            </div>
            <div className="form-section-label">Patient</div>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label className="field-label-block opening-date-field">
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
              {editingEntryAvailabilityError && <p className="form-error-text compact-error">{editingEntryAvailabilityError}</p>}
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
              <button
                className="btn-primary"
                disabled={Boolean(editingEntryAvailabilityError)}
                onClick={saveEditingEntry}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PROVIDER MODAL */}
      {editingProvider && (
        <div className="modal-backdrop" onClick={() => setEditingProvider(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Provider</h2>
              <button className="close-action-button" aria-label="Close" onClick={() => setEditingProvider(null)}>×</button>
            </div>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label className="field-label-block field-grow">
                <span className="field-label-text">Provider name</span>
                <input
                  value={editingProvider.name}
                  onChange={e => setEditingProvider({ ...editingProvider, name: e.target.value })}
                  // FIX: Enter key submits the edit
                  onKeyDown={e => { if(e.key === "Enter") saveEditingProvider(); }}
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
              <button
                className="btn-primary"
                disabled={!editingProvider.name.trim()}
                onClick={saveEditingProvider}
              >
                Save Changes
              </button>
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

function parseImportedWaitlistSheet(sheet: XLSX.WorkSheet): ImportPreviewRow[]{
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];
  const indexedRows = rows
    .map((cells, index) => ({ cells, rowNumber: index + 1 }))
    .filter(row => !isImportedSheetRowEmpty(row.cells));
  if(indexedRows.length === 0) return [];
  const firstRowIsHeader = looksLikeImportHeaderRow(indexedRows[0].cells);
  if(!firstRowIsHeader){
    return indexedRows
      .filter(row => !isImportedSheetRowEmpty(row.cells))
      .map((row, index) => parseImportedWaitlistRowFromCells(row.cells, row.rowNumber, index + 1));
  }
  const headerMap = buildImportHeaderMap(indexedRows[0].cells);
  const dataRows = indexedRows.slice(1);
  return dataRows
    .filter(row => !isImportedSheetRowEmpty(row.cells))
    .map((row, index) => parseImportedWaitlistRowFromHeaderMap(row.cells, headerMap, row.rowNumber, index + 1));
}

function annotateImportedProviders(rows: ImportPreviewRow[], providers: Provider[]): ImportPreviewRow[]{
  const existing = new Set(providers.map(p => p.name.trim().toLowerCase()));
  const seenNew = new Set<string>();
  return rows.map(row => {
    if(row.status === "ERROR") return row;
    const key = row.provider.trim().toLowerCase();
    if(!key || existing.has(key)) return row;
    const message = seenNew.has(key)
      ? "New provider already listed in this import."
      : "New provider will be added.";
    seenNew.add(key);
    return {
      ...row,
      messages: [...row.messages, message],
    };
  });
}

function parseImportedWaitlistRowFromHeaderMap(
  cells: unknown[],
  headerMap: Map<string, number>,
  rowNumber: number,
  id: number,
): ImportPreviewRow {
  const getCell = (...names: string[]) => {
    for (const name of names){
      const index = headerMap.get(normalizeImportHeader(name));
      if(index !== undefined) return cells[index];
    }
    return "";
  };
  return parseImportedWaitlistRowFromValues({
    dateAdded: getCell("dateadded", "date"),
    name: getCell("name", "patient", "patientname"),
    provider: getCell("provider", "doctor"),
    tier: getCell("tier", "priority", "prioritytier"),
    reason: getCell("reason", "notes"),
    dates: getCell("dates", "availabledays", "days"),
    times: getCell("times", "availabletimes", "availability", "time"),
  }, rowNumber, id);
}

function parseImportedWaitlistRowFromCells(cells: unknown[], rowNumber: number, id: number): ImportPreviewRow {
  return parseImportedWaitlistRowFromValues({
    dateAdded: cells[0],
    name: cells[1],
    provider: cells[2],
    tier: cells[3],
    reason: cells[4],
    dates: cells[5],
    times: cells[6],
  }, rowNumber, id);
}

function parseImportedWaitlistRowFromValues(
  values: {
    dateAdded: unknown;
    name: unknown;
    provider: unknown;
    tier: unknown;
    reason: unknown;
    dates: unknown;
    times: unknown;
  },
  rowNumber: number,
  id: number,
): ImportPreviewRow {
  const raw = {
    dateAdded: cellToImportText(values.dateAdded),
    name: cellToImportText(values.name),
    provider: cellToImportText(values.provider),
    tier: cellToImportText(values.tier),
    reason: cellToImportText(values.reason),
    dates: cellToImportText(values.dates),
    times: cellToImportText(values.times),
  };
  const messages: string[] = [];
  const parsedDate = parseImportedDate(values.dateAdded);
  if(!parsedDate) messages.push("Invalid date added.");
  const parsedName = parseImportedName(raw.name);
  if(!parsedName) messages.push("Missing name.");
  const provider = raw.provider.trim();
  if(!provider) messages.push("Missing provider.");
  const tier = parseImportedTier(raw.tier);
  if(!tier) messages.push("Tier must be 1, 2, or 3.");
  const parsedDays = parseImportedDays(raw.dates);
  if(parsedDays.error) messages.push(parsedDays.error);
  const parsedTimes = parseImportedTimeRanges(raw.times);
  if(parsedTimes.error) messages.push(parsedTimes.error);
  return {
    id,
    rowNumber,
    dateAdded: parsedDate ?? "",
    firstName: parsedName?.firstName ?? "",
    lastName: parsedName?.lastName ?? raw.name.trim(),
    provider,
    tier: tier ?? 1,
    reason: raw.reason.trim() || getTierReason(tier ?? 1),
    availableDays: parsedDays.days,
    availableTimes: parsedTimes.ranges,
    status: messages.length > 0 ? "ERROR" : "READY",
    messages,
    raw,
  };
}

function buildImportHeaderMap(headerCells: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerCells.forEach((cell, index) => {
    const normalized = normalizeImportHeader(cellToImportText(cell));
    if(normalized) map.set(normalized, index);
  });
  return map;
}

function normalizeImportHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isImportedSheetRowEmpty(cells: unknown[]): boolean {
  return cells.every(cell => cellToImportText(cell).trim() === "");
}

function looksLikeImportHeaderRow(cells: unknown[]): boolean {
  const normalized = cells.map(cell => normalizeImportHeader(cellToImportText(cell)));
  return (
    normalized.includes("dateadded") &&
    normalized.includes("name") &&
    normalized.includes("provider")
  );
}

function cellToImportText(value: unknown): string {
  if(value === null || value === undefined) return "";
  if(value instanceof Date) return toDateInputValue(value);
  return String(value).trim();
}

function parseImportedDate(value: unknown): string | null {
  if(value instanceof Date && !Number.isNaN(value.getTime())) return toDateInputValue(value);
  if(typeof value === "number" && Number.isFinite(value)){
    const parsed = XLSX.SSF.parse_date_code(value);
    if(parsed){
      const date = new Date(parsed.y, parsed.m - 1, parsed.d);
      return toDateInputValue(date);
    }
  }
  const text = cellToImportText(value).trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  if(!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if(year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  if(date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return toDateInputValue(date);
}

function parseImportedName(value: string): { firstName: string; lastName: string } | null {
  const clean = value.trim().replace(/\s+/g, " ");
  if(!clean) return null;
  if(clean.includes(",")){
    const [last, ...rest] = clean.split(",");
    return { firstName: rest.join(",").trim(), lastName: last.trim() };
  }
  const parts = clean.split(" ");
  if(parts.length === 1) return { firstName: "", lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function parseImportedTier(value: string): 1 | 2 | 3 | null {
  const match = value.match(/[123]/);
  if(!match) return null;
  const tier = Number(match[0]);
  return tier === 1 || tier === 2 || tier === 3 ? tier : null;
}

function parseImportedDays(value: string): { days: DayCode[]; error?: string } {
  const text = value.trim();
  if(!text || /^any$/i.test(text)) return { days: [] };
  const days: DayCode[] = [];
  const invalid: string[] = [];
  const tokens = text.split(/[\s,;/]+/).map(t => t.trim()).filter(Boolean);
  for (const token of tokens){
    const parsed = parseImportedDayCode(token);
    if(!parsed){
      invalid.push(token);
      continue;
    }
    if(!days.includes(parsed)) days.push(parsed);
  }
  return invalid.length > 0
    ? { days, error: `Invalid date value: ${invalid.join(", ")}.` }
    : { days };
}

function parseImportedDayCode(token: string): DayCode | null {
  const clean = token.toLowerCase().replace(/[^a-z]/g, "");
  if(["m", "mon", "monday"].includes(clean)) return "M";
  if(["t", "tu", "tue", "tues", "tuesday"].includes(clean)) return "Tu";
  if(["w", "wed", "wednesday"].includes(clean)) return "W";
  if(["th", "thu", "thur", "thurs", "thursday"].includes(clean)) return "Th";
  if(["f", "fri", "friday"].includes(clean)) return "F";
  return null;
}

function parseImportedTimeRanges(value: string): { ranges: string[]; error?: string } {
  const text = value.trim();
  if(!text || /^any$/i.test(text)) return { ranges: [] };
  const ranges: string[] = [];
  const invalid: string[] = [];
  const pieces = text
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .split(/[,;]+/)
    .map(piece => piece.trim())
    .filter(Boolean);
  for (const piece of pieces){
    const parsed = parseSingleImportedTimeRange(piece);
    if(!parsed){
      invalid.push(piece);
      continue;
    }
    ranges.push(`${minutesToTimeString(parsed.start)}-${minutesToTimeString(parsed.end)}`);
  }
  const normalizedRanges = normalizeSerializedTimeRanges(ranges);
  return invalid.length > 0
    ? { ranges: normalizedRanges, error: `Invalid time range: ${invalid.join(", ")}.` }
    : { ranges: normalizedRanges };
}

function parseSingleImportedTimeRange(value: string): TimeWindow | null {
  const cleanValue = value.trim();
  if (!cleanValue.includes("-")) {
    const startClock = parseImportedClock(cleanValue);
    if (!startClock) return null;
    const start = importedClockToMinutes(startClock);
    const end = CAL_END_MIN;
    if (
      start < CAL_START_MIN ||
      start >= CAL_END_MIN ||
      end <= start ||
      !hasMinimumSlot(start, end, BASE_APPOINTMENT_MINUTES)
    ) {
      return null;
    }
    return { start, end };
  }
  const match = cleanValue.match(/^(.+?)-(.+)$/);
  if (!match) return null;
  const startClock = parseImportedClock(match[1]);
  const endClock = parseImportedClock(match[2]);
  if (!startClock || !endClock) return null;
  let startSuffix = startClock.suffix;
  let endSuffix = endClock.suffix;
  if (!startSuffix && endSuffix) {
    if (endSuffix === "pm") {
      startSuffix =
        startClock.hour === 12
          ? "pm"
          : startClock.hour > endClock.hour && startClock.hour >= 8
            ? "am"
            : "pm";
    } else {
      startSuffix = "am";
    }
  }
  if (startSuffix && !endSuffix) {
    if (startSuffix === "am" && endClock.hour < startClock.hour) {
      endSuffix = "pm";
    } else if (
      startSuffix === "am" &&
      endClock.hour >= 1 &&
      endClock.hour <= 7
    ) {
      endSuffix = "pm";
    } else {
      endSuffix = startSuffix;
    }
  }
  const start = importedClockToMinutes({ ...startClock, suffix: startSuffix });
  let end = importedClockToMinutes({ ...endClock, suffix: endSuffix });
  if (end <= start && !endClock.suffix) {
    const endAsPm = importedClockToMinutes({ ...endClock, suffix: "pm" });
    if (endAsPm > start) end = endAsPm;
  }
  if (
    start < CAL_START_MIN ||
    end > CAL_END_MIN ||
    end <= start ||
    !hasMinimumSlot(start, end, BASE_APPOINTMENT_MINUTES)
  ) {
    return null;
  }
  return { start, end };
}

function parseImportedClock(value: string): { hour: number; minute: number; suffix?: "am" | "pm" } | null {
  const clean = value.trim().toLowerCase().replace(/\s+/g, "");
  const suffixMatch = clean.match(/(am|pm|a|p)$/);
  const suffix = suffixMatch ? (suffixMatch[1].startsWith("a") ? "am" : "pm") : undefined;
  const body = suffixMatch ? clean.slice(0, -suffixMatch[1].length) : clean;
  const match = body.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if(!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if(hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  return { hour, minute, suffix };
}

function importedClockToMinutes(clock: { hour: number; minute: number; suffix?: "am" | "pm" }): number {
  if(!clock.suffix) return timeToMinutes(`${clock.hour}:${String(clock.minute).padStart(2, "0")}`);
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

function getCurrentWeekStartDate(): string {
  const date = startOfLocalDay(new Date());
  const day  = date.getDay();
  let daysToMonday = day === 0 ? 1 : 1 - day;
  if(day === 6) daysToMonday = 2;
  date.setDate(date.getDate() + daysToMonday);
  return toDateInputValue(date);
}

function getDefaultOpeningDate(): string {
  const date = startOfLocalDay(new Date());
  const day  = date.getDay();
  if(day === 6) date.setDate(date.getDate() + 2);
  if(day === 0) date.setDate(date.getDate() + 1);
  return toDateInputValue(date);
}

function moveDateByDays(dateString: string, days: number): string {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function isDateOlderThanRetentionDays(dateString: string, today: Date): boolean {
  const cutoff = startOfLocalDay(today);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  return parseLocalDate(dateString).getTime() < cutoff.getTime();
}

function isPastDate(dateString: string, todayDateString: string): boolean {
  return parseLocalDate(dateString).getTime() < parseLocalDate(todayDateString).getTime();
}

function isAppointmentStartInPast(dateString: string, startTime: string, now = new Date()): boolean {
  const appointmentDay = parseLocalDate(dateString).getTime();
  const today = startOfLocalDay(now).getTime();
  if(appointmentDay < today) return true;
  if(appointmentDay > today) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return timeToMinutes(startTime) < currentMinutes;
}

function formatDisplayDate(dateString: string): string {
  return parseLocalDate(dateString).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function getDayCodeFromDate(dateString: string): DayCode | null {
  const day = parseLocalDate(dateString).getDay();
  if(day === 1) return "M";
  if(day === 2) return "Tu";
  if(day === 3) return "W";
  if(day === 4) return "Th";
  if(day === 5) return "F";
  return null;
}

function timeToMinutes(time: string): number {
  const [hourStr, minuteStr] = time.split(":");
  let hour = Number(hourStr);
  const minute = Number(minuteStr ?? "0");
  if(hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + minute;
}

function minutesToTimeString(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60;
  const disp = hour > 12 ? hour - 12 : hour;
  return `${disp}:${String(min).padStart(2, "0")}`;
}

function formatDisplayTime(time: string): string {
  const totalMinutes = timeToMinutes(time);
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(startTime: string, endTime: string): string {
  return `${formatDisplayTime(startTime)} – ${formatDisplayTime(endTime)}`;
}

function snapToInterval(minutes: number, interval: number): number {
  return Math.round(minutes / interval) * interval;
}

function getOpeningTopPct(startTime: string): number {
  return ((timeToMinutes(startTime) - CAL_START_MIN) / CAL_SPAN) * 100;
}

function getOpeningHeightPct(startTime: string, endTime: string): number {
  return ((timeToMinutes(endTime) - timeToMinutes(startTime)) / CAL_SPAN) * 100;
}

function getOpeningDurationError(startTime: string, endTime: string): string {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if(end <= start) return "End time must be after start time.";
  if(end - start < BASE_APPOINTMENT_MINUTES){
    return `Openings must be at least ${BASE_APPOINTMENT_MINUTES} minutes.`;
  }
  return "";
}

function getAvailabilityRangeError(ranges: TimeRangeDraft[]): string {
  const invalidRange = ranges.find(range =>
    timeToMinutes(range.endTime) <= timeToMinutes(range.startTime) ||
    timeToMinutes(range.endTime) - timeToMinutes(range.startTime) < BASE_APPOINTMENT_MINUTES,
  );
  return invalidRange
    ? `Patient availability time ranges must be at least ${BASE_APPOINTMENT_MINUTES} minutes.`
    : "";
}

function parseTimeRange(range: string): { start: number; end: number } {
  const [start, end] = range.split("-").map(part => part.trim());
  return { start: timeToMinutes(start), end: timeToMinutes(end) };
}

function hasMinimumSlot(start: number, end: number, minimumMinutes: number): boolean {
  return end - start >= minimumMinutes;
}

function isSurgeryOpening(opening: Opening): boolean {
  return Boolean((opening as Opening & { isSurgery?: boolean }).isSurgery);
}

function getMinimumAppointmentMinutes(opening: Opening): number {
  return isSurgeryOpening(opening) ? SURGERY_APPOINTMENT_MINUTES : BASE_APPOINTMENT_MINUTES;
}

function getOverlapWindow(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  minimumMinutes: number,
): TimeWindow | null {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return hasMinimumSlot(start, end, minimumMinutes) ? { start, end } : null;
}

function getEligibleScheduleWindows(entry: WaitlistEntry, opening: Opening): TimeWindow[] {
  const isFlexibleUrgent = entry.tier === 1 && entry.availableDays.length === 0 && entry.availableTimes.length === 0;
  const dayMatches = isFlexibleUrgent || entry.availableDays.length === 0 || entry.availableDays.includes(opening.day);
  if(!dayMatches) return [];
  const openingStart = timeToMinutes(opening.startTime);
  const openingEnd = timeToMinutes(opening.endTime);
  const minimumMinutes = getMinimumAppointmentMinutes(opening);
  if(entry.availableTimes.length === 0){
    return hasMinimumSlot(openingStart, openingEnd, minimumMinutes) ? [{ start: openingStart, end: openingEnd }] : [];
  }
  return entry.availableTimes
    .map(parseTimeRange)
    .map(r => getOverlapWindow(r.start, r.end, openingStart, openingEnd, minimumMinutes))
    .filter((w): w is TimeWindow => w !== null);
}

function isEntryAvailableForOpening(entry: WaitlistEntry, opening: Opening): boolean {
  return getEligibleScheduleWindows(entry, opening).length > 0;
}

function formatAvailableTimes(times: string[]): string {
  if(times.length === 0) return "Any";
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

function getScheduleStartOptions(windows: TimeWindow[], minimumMinutes: number): string[] {
  return uniqueSortedTimes(windows.flatMap(w => {
    const options: string[] = [];
    for (let min = w.start; min <= w.end - minimumMinutes; min += SNAP){
      options.push(minutesToTimeString(min));
    }
    return options;
  }));
}

function getScheduleEndOptions(windows: TimeWindow[], startTime: string, minimumMinutes: number): string[] {
  const start = timeToMinutes(startTime);
  return uniqueSortedTimes(windows.flatMap(w => {
    if(start < w.start || start + minimumMinutes > w.end) return [];
    const options: string[] = [];
    for (let min = start + minimumMinutes; min <= w.end; min += SNAP){
      options.push(minutesToTimeString(min));
    }
    return options;
  }));
}

function getDefaultScheduleSelection(windows: TimeWindow[], minimumMinutes = BASE_APPOINTMENT_MINUTES): ScheduleSelection {
  const first = windows[0] ?? { start: CAL_START_MIN, end: CAL_START_MIN + minimumMinutes };
  return {
    startTime: minutesToTimeString(first.start),
    endTime: minutesToTimeString(Math.min(first.start + minimumMinutes, first.end)),
  };
}

function normalizeScheduleSelection(
  selection: ScheduleSelection,
  changedField: "startTime" | "endTime",
  windows: TimeWindow[],
  minimumMinutes: number,
): ScheduleSelection {
  if(windows.length === 0) return getDefaultScheduleSelection(windows, minimumMinutes);
  const startOptions = getScheduleStartOptions(windows, minimumMinutes);
  if(startOptions.length === 0) return getDefaultScheduleSelection(windows, minimumMinutes);
  let startTime = selection.startTime;
  if(!startOptions.includes(startTime)) startTime = startOptions[0];
  let endOptions = getScheduleEndOptions(windows, startTime, minimumMinutes);
  if(endOptions.length === 0){
    startTime  = startOptions[0];
    endOptions = getScheduleEndOptions(windows, startTime, minimumMinutes);
    if(endOptions.length === 0) return getDefaultScheduleSelection(windows, minimumMinutes);
  }
  let endTime = selection.endTime;
  const endTooEarly = timeToMinutes(endTime) - timeToMinutes(startTime) < minimumMinutes;
  if(!endOptions.includes(endTime) || (changedField === "startTime" && endTooEarly)){
    endTime = endOptions[0];
  }
  return { startTime, endTime };
}

function getResolvedScheduleSelection(
  entry: WaitlistEntry,
  opening: Opening,
  saved: ScheduleSelection | undefined,
): ScheduleSelection {
  const minimumMinutes = getMinimumAppointmentMinutes(opening);
  const windows = getEligibleScheduleWindows(entry, opening);
  return normalizeScheduleSelection(
    saved ?? getDefaultScheduleSelection(windows, minimumMinutes),
    "endTime",
    windows,
    minimumMinutes,
  );
}

function getNextTimeRangeId(ranges: TimeRangeDraft[]): number {
  return ranges.length === 0 ? 1 : Math.max(...ranges.map(r => r.id)) + 1;
}

function rangeToDraft(range: string, fallbackId = 0): TimeRangeDraft {
  const parsed = parseTimeRange(range);
  return {
    id: fallbackId,
    startTime: minutesToTimeString(parsed.start),
    endTime: minutesToTimeString(parsed.end),
  };
}

function normalizeDraftTimeRange(range: TimeRangeDraft, changedField: "startTime" | "endTime"): TimeRangeDraft {
  let start = timeToMinutes(range.startTime);
  let end = timeToMinutes(range.endTime);
  if(end - start < BASE_APPOINTMENT_MINUTES){
    if(changedField === "startTime"){
      end = Math.min(CAL_END_MIN, start + BASE_APPOINTMENT_MINUTES);
      if(end - start < BASE_APPOINTMENT_MINUTES) start = end - BASE_APPOINTMENT_MINUTES;
    } else {
      start = Math.max(CAL_START_MIN, end - BASE_APPOINTMENT_MINUTES);
      if(end - start < BASE_APPOINTMENT_MINUTES) end = start + BASE_APPOINTMENT_MINUTES;
    }
  }
  return { ...range, startTime: minutesToTimeString(start), endTime: minutesToTimeString(end) };
}

function normalizeAndMergeTimeRangeDrafts(ranges: TimeRangeDraft[]): TimeRangeDraft[] {
  const sortedRanges = ranges
    .map(r => normalizeDraftTimeRange(r, "endTime"))
    .filter(r => hasMinimumSlot(timeToMinutes(r.startTime), timeToMinutes(r.endTime), BASE_APPOINTMENT_MINUTES))
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  const merged: TimeRangeDraft[] = [];
  for(const range of sortedRanges){
    const start = timeToMinutes(range.startTime);
    const end = timeToMinutes(range.endTime);
    const last = merged[merged.length - 1];
    if(!last){
      merged.push({ ...range });
      continue;
    }
    const lastEnd = timeToMinutes(last.endTime);
    if(start <= lastEnd){
      last.endTime = minutesToTimeString(Math.max(lastEnd, end));
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map((range, index) => ({ ...range, id: range.id || index + 1 }));
}

function normalizeSerializedTimeRanges(ranges: string[]): string[] {
  return serializeTimeRangeDrafts(ranges.map((range, index) => rangeToDraft(range, index + 1)));
}

function getNextAvailableTimeRangeDraft(ranges: TimeRangeDraft[]): TimeRangeDraft | null {
  const merged = normalizeAndMergeTimeRangeDrafts(ranges);
  const nextId = getNextTimeRangeId(ranges);
  const preferredStarts = [9 * 60, ...buildMinuteRange(CAL_START_MIN, CAL_END_MIN - BASE_APPOINTMENT_MINUTES, 60)];
  const uniqueStarts = Array.from(new Set(preferredStarts));
  for(const start of uniqueStarts){
    const end = start + BASE_APPOINTMENT_MINUTES;
    const overlapsExisting = merged.some(range => {
      const rangeStart = timeToMinutes(range.startTime);
      const rangeEnd = timeToMinutes(range.endTime);
      return start < rangeEnd && end > rangeStart;
    });
    if(!overlapsExisting){
      return {
        id: nextId,
        startTime: minutesToTimeString(start),
        endTime: minutesToTimeString(end),
      };
    }
  }
  return null;
}

function buildMinuteRange(startMin: number, endMin: number, stepMin: number): number[] {
  const values: number[] = [];
  for(let value = startMin; value <= endMin; value += stepMin) values.push(value);
  return values;
}

function serializeTimeRangeDrafts(ranges: TimeRangeDraft[]): string[] {
  return normalizeAndMergeTimeRangeDrafts(ranges)
    .map(r => `${r.startTime}-${r.endTime}`);
}

function splitOpeningForAppointment(
  openings: Opening[],
  openingId: number,
  appointmentStartTime: string,
  appointmentEndTime: string,
): Opening[] {
  const apptStart = timeToMinutes(appointmentStartTime);
  const apptEnd = timeToMinutes(appointmentEndTime);
  let nextId = getNextId(openings);
  const split = openings.flatMap(opening => {
    if(opening.id !== openingId) return [opening];
    const oStart = timeToMinutes(opening.startTime);
    const oEnd = timeToMinutes(opening.endTime);
    if(apptStart <= oStart && apptEnd >= oEnd) return [];
    if(apptStart <= oStart) return [{ ...opening, startTime: minutesToTimeString(apptEnd) }];
    if(apptEnd >= oEnd) return [{ ...opening, endTime: minutesToTimeString(apptStart) }];
    return [
      { ...opening, endTime: minutesToTimeString(apptStart) },
      { ...opening, id: nextId++, startTime: minutesToTimeString(apptEnd) },
    ];
  });
  return mergeSameProviderOpenings(split);
}

function mergeSameProviderOpenings(openings: Opening[], preferredId?: number | null): Opening[] {
  const groups = new Map<string, Opening[]>();
  for (const opening of openings){
    const key = `${opening.provider}__${opening.date}`;
    groups.set(key, [...(groups.get(key) ?? []), opening]);
  }
  const merged: Opening[] = [];
  for (const group of groups.values()){
    const sorted = [...group].sort((a, b) => {
      const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      return diff !== 0 ? diff : timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
    });
    let current: Opening | null = null;
    let currentIds: Set<number>    = new Set();
    for (const opening of sorted){
      if(current === null){
        current = { ...opening };
        currentIds = new Set([opening.id]);
        continue;
      }
      const currentEnd = timeToMinutes(current.endTime);
      const openingStart = timeToMinutes(opening.startTime);
      const openingEnd = timeToMinutes(opening.endTime);
      if(openingStart <= currentEnd){
        current.endTime = minutesToTimeString(Math.max(currentEnd, openingEnd));
        currentIds.add(opening.id);
        continue;
      }
      if(preferredId != null && currentIds.has(preferredId)) current.id = preferredId;
      merged.push(current);
      current = { ...opening };
      currentIds = new Set([opening.id]);
    }
    if(current !== null){
      if(preferredId != null && currentIds.has(preferredId)) current.id = preferredId;
      merged.push(current);
    }
  }
  return merged.sort((a, b) => {
    const dateDiff = a.date.localeCompare(b.date);
    if(dateDiff !== 0) return dateDiff;
    const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    if(startDiff !== 0) return startDiff;
    return a.provider.localeCompare(b.provider);
  });
}

function buildOpeningSegments(dayOpenings: Opening[]): OpeningSegment[] {
  const points = new Set<number>();
  dayOpenings.forEach(o => { points.add(timeToMinutes(o.startTime)); points.add(timeToMinutes(o.endTime)); });
  const breakpoints = [...points].sort((a, b) => a - b);
  const rawSegments: OpeningSegment[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++){
    const segStart = breakpoints[i];
    const segEnd = breakpoints[i + 1];
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
        startTime: minutesToTimeString(segStart),
        endTime: minutesToTimeString(segEnd),
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

function mergeAdjacentOpeningSegments(segments: OpeningSegment[]): OpeningSegment[] {
  const merged: OpeningSegment[] = [];
  for (const seg of segments){
    const prev = merged[merged.length - 1];
    if(
      prev &&
      prev.opening.id === seg.opening.id &&
      prev.endTime === seg.startTime &&
      prev.left === seg.left &&
      prev.width === seg.width
    ){
      prev.endTime = seg.endTime;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function labelAndConnectOpeningSegments(segments: OpeningSegment[]): OpeningSegment[] {
  return segments.map(segment => {
    const same = segments.filter(s => s.opening.id === segment.opening.id);
    const first = same.reduce((b, c) => timeToMinutes(c.startTime) < timeToMinutes(b.startTime) ? c : b);
    const last = same.reduce((b, c) => timeToMinutes(c.endTime) > timeToMinutes(b.endTime) ? c : b);
    const label = same.reduce((b, c) => {
      if(c.widthPercent > b.widthPercent) return c;
      if(c.widthPercent === b.widthPercent){
        const bDur = timeToMinutes(b.endTime) - timeToMinutes(b.startTime);
        const cDur = timeToMinutes(c.endTime) - timeToMinutes(c.startTime);
        return cDur > bDur ? c : b;
      }
      return b;
    });
    return {
      ...segment,
      showLabel: segment.startTime === label.startTime && segment.endTime === label.endTime && segment.left === label.left,
      isFirstPiece: segment.startTime === first.startTime && segment.left === first.left && segment.width === first.width,
      isLastPiece: segment.endTime === last.endTime && segment.left === last.left && segment.width === last.width,
    };
  });
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function searchableTextContains(query: string, values: Array<string | number | undefined | null>): boolean {
  const normalized = normalizeSearchQuery(query);
  if(!normalized) return true;
  return values
    .filter(value => value !== undefined && value !== null)
    .map(String)
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function waitlistEntryMatchesSearch(entry: WaitlistEntry, query: string): boolean {
  return searchableTextContains(query, [
    entry.firstName,
    entry.lastName,
    `${entry.firstName} ${entry.lastName}`,
    `${entry.lastName}, ${entry.firstName}`,
    getFullName(entry),
    entry.provider,
    entry.reason,
    `Tier ${entry.tier}`,
    getTierReason(entry.tier),
    entry.status,
    entry.dateAdded,
    entry.availableDays.join(" "),
    formatAvailableTimes(entry.availableTimes),
  ]);
}

function scheduledRecordMatchesSearch(record: ScheduledRecord, query: string): boolean {
  return searchableTextContains(query, [
    record.firstName,
    record.lastName,
    `${record.firstName} ${record.lastName}`,
    `${record.lastName}, ${record.firstName}`,
    formatPersonName(record.firstName, record.lastName),
    record.provider,
    record.reason,
    `Tier ${record.tier}`,
    getTierReason(record.tier),
    record.status,
    record.dateScheduled,
    record.appointmentDate,
    formatDisplayDate(record.appointmentDate),
    record.appointmentDay,
    formatTimeRange(record.startTime, record.endTime),
  ]);
}

function removedRecordMatchesSearch(record: RemovedRecord, query: string): boolean {
  return searchableTextContains(query, [
    record.firstName,
    record.lastName,
    `${record.firstName} ${record.lastName}`,
    `${record.lastName}, ${record.firstName}`,
    formatPersonName(record.firstName, record.lastName),
    record.provider,
    record.reason,
    `Tier ${record.tier}`,
    getTierReason(record.tier),
    record.status,
    record.dateAdded,
    record.dateRemoved,
    formatDisplayDate(record.dateAdded),
    formatDisplayDate(record.dateRemoved),
  ]);
}

function buildTimeOptions(startMin: number, endMin: number, stepMin: number): string[] {
  const options: string[] = [];
  for (let min = startMin; min <= endMin; min += stepMin){
    options.push(minutesToTimeString(min));
  }
  return options;
}

function uniqueSortedTimes(times: string[]): string[] {
  return [...new Set(times)].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

function filterWithoutStateChange<T>(items: T[], keep: (item: T) => boolean): T[] {
  const filtered = items.filter(keep);
  return filtered.length === items.length ? items : filtered;
}

function getNextId(items: { id: number }[]): number {
  if(items.length === 0) return 1;
  return items.reduce((max, item) => item.id > max ? item.id : max, 0) + 1;
}

function formatPersonName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last  = lastName.trim();
  if(first && last) return `${last}, ${first}`;
  return last || first || "—";
}

function getFullName(entry: WaitlistEntry): string {
  return formatPersonName(entry.firstName, entry.lastName);
}

function getTierReason(tier: 1 | 2 | 3): string {
  if(tier === 1) return "Urgent";
  if(tier === 2) return "Semi-urgent";
  return "Routine";
}

function compareScheduledRecordsByAppointment(a: ScheduledRecord, b: ScheduledRecord): number {
  const dateDiff = a.appointmentDate.localeCompare(b.appointmentDate);
  if(dateDiff !== 0) return dateDiff;
  const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  if(startDiff !== 0) return startDiff;
  return a.lastName.localeCompare(b.lastName);
}

function getSortIndicator(current: SortField, direction: "asc" | "desc", column: SortField): string {
  if(current !== column) return "";
  return direction === "asc" ? "↑" : "↓";
}

export default App;