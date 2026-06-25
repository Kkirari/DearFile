/**
 * Calendar tab — month calendar grid view with event dots + list of selected day's events.
 */

"use client";

import { useState } from "react";
import { Calendar, Clock, Trash2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendarEvents } from "@/hooks/use-calendar-events";
import type { CalendarEvent } from "@/lib/db";

interface CalendarTabProps {
  userId: string;
}

export function CalendarTab({ userId }: CalendarTabProps) {
  const { events, loading, error, cancelEvent } = useCalendarEvents(userId);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // 0-indexed
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#9b869c] border-r-transparent"></div>
          <p className="mt-3 text-sm text-[#b0a396]">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const hasEvents = events.length > 0;

  // Build event map: date -> events[]
  const eventsByDate = new Map<string, CalendarEvent[]>();
  events.forEach((event) => {
    const existing = eventsByDate.get(event.eventDate) ?? [];
    existing.push(event);
    eventsByDate.set(event.eventDate, existing);
  });

  // Events for selected date
  const selectedDateEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : [];

  const goToPrevMonth = () => {
    setCurrentMonth((prev) => {
      if (prev.month === 0) return { year: prev.year - 1, month: 11 };
      return { year: prev.year, month: prev.month - 1 };
    });
  };

  const goToNextMonth = () => {
    setCurrentMonth((prev) => {
      if (prev.month === 11) return { year: prev.year + 1, month: 0 };
      return { year: prev.year, month: prev.month + 1 };
    });
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentMonth({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(today);
  };

  return (
    <div className="page-fade min-h-screen bg-[#f4f3ee] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#e0d8cc] bg-[#fbfaf6]/95 backdrop-blur-lg">
        <div className="mx-auto max-w-2xl px-4 py-4">
          <h1 className="t-title text-[#4a4036]">
            📅 ปฏิทิน
          </h1>
          <p className="t-body mt-1 text-[#b0a396]">Calendar</p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {/* Month Calendar Grid */}
        <MonthCalendar
          year={currentMonth.year}
          month={currentMonth.month}
          eventsByDate={eventsByDate}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onPrevMonth={goToPrevMonth}
          onNextMonth={goToNextMonth}
          onToday={goToToday}
          today={today}
        />

        {/* Selected Day's Events */}
        {selectedDate && selectedDateEvents.length > 0 && (
          <div>
            <h2 className="t-strong text-[#4a4036] mb-3">
              {formatDateThai(selectedDate)}
            </h2>
            <div className="space-y-2">
              {selectedDateEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => setSelectedEvent(event)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!hasEvents && (
          <div className="text-center py-12">
            <Calendar size={48} className="mx-auto text-[#e0d8cc] mb-4" />
            <p className="t-strong text-[#4a4036] mb-2">
              ยังไม่มีการนัดหมาย
            </p>
            <p className="t-body text-[#b0a396]">
              ลองสั่งใน LINE เพื่อเพิ่มเตือนความจำ
              <br />
              Send a message in LINE to add a reminder
            </p>
          </div>
        )}
      </div>

      {/* Event Detail Sheet */}
      {selectedEvent && (
        <EventDetailSheet
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={async () => {
            await cancelEvent(selectedEvent.id);
            setSelectedEvent(null);
          }}
        />
      )}
    </div>
  );
}

interface MonthCalendarProps {
  year: number;
  month: number; // 0-indexed
  eventsByDate: Map<string, CalendarEvent[]>;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  today: string;
}

function MonthCalendar({
  year,
  month,
  eventsByDate,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  onToday,
  today,
}: MonthCalendarProps) {
  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

  // Build calendar grid (6 weeks max)
  const calendarDays: (number | null)[] = [];

  // Leading empty cells
  for (let i = 0; i < startDayOfWeek; i++) {
    calendarDays.push(null);
  }

  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  const dayOfWeekLabels = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  return (
    <div className="rounded-2xl bg-[#fbfaf6] border border-[#e0d8cc] p-4">
      {/* Month/Year Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onPrevMonth}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#b0a396] transition-colors hover:bg-[#f4f3ee]"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <h3 className="t-strong text-[#4a4036]">
            {thaiMonths[month]} {year + 543}
          </h3>
        </div>
        <button
          onClick={onNextMonth}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#b0a396] transition-colors hover:bg-[#f4f3ee]"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Today Button */}
      <div className="flex justify-center mb-3">
        <button
          onClick={onToday}
          className="t-caption px-3 py-1 rounded-full bg-[#9b869c]/10 text-[#9b869c] hover:bg-[#9b869c]/20 transition-colors"
        >
          วันนี้
        </button>
      </div>

      {/* Day of Week Labels */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {dayOfWeekLabels.map((label, idx) => (
          <div
            key={idx}
            className="t-caption text-center text-[#b0a396] font-bold"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="aspect-square" />;
          }

          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;
          const hasEvents = eventsByDate.has(dateStr);
          const eventCount = eventsByDate.get(dateStr)?.length ?? 0;

          return (
            <button
              key={day}
              onClick={() => onSelectDate(dateStr)}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center transition-all relative ${
                isSelected
                  ? "bg-[#9b869c] text-white"
                  : isToday
                    ? "bg-[#9b869c]/20 text-[#9b869c] font-bold"
                    : "text-[#4a4036] hover:bg-[#f4f3ee]"
              }`}
            >
              <span className="t-body">{day}</span>
              {hasEvents && (
                <div className="flex gap-0.5 mt-0.5">
                  {Array.from({ length: Math.min(eventCount, 3) }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-1 rounded-full ${
                        isSelected ? "bg-white" : "bg-[#9b869c]"
                      }`}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface EventCardProps {
  event: CalendarEvent;
  onClick: () => void;
}

function EventCard({ event, onClick }: EventCardProps) {
  const timeStr = event.eventTime ? event.eventTime.slice(0, 5) : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl bg-[#fbfaf6] border border-[#e0d8cc] p-4 transition-all active:scale-[0.98] hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        {timeStr ? (
          <div className="flex-shrink-0">
            <Clock size={18} className="text-[#9b869c]" />
          </div>
        ) : (
          <div className="flex-shrink-0">
            <Calendar size={18} className="text-[#b0a396]" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="t-strong text-[#4a4036] line-clamp-2">
            {event.title}
          </p>
          {event.description && (
            <p className="t-body text-[#b0a396] mt-1 line-clamp-1">
              {event.description}
            </p>
          )}
          <p className="t-caption text-[#b0a396] mt-2">
            {timeStr ? `${timeStr} น.` : "ตลอดวัน"}
          </p>
        </div>
      </div>
    </button>
  );
}

interface EventDetailSheetProps {
  event: CalendarEvent;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

function EventDetailSheet({ event, onClose, onDelete }: EventDetailSheetProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("ยืนยันการลบเตือนความจำนี้?")) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("ลบไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="backdrop-enter fixed inset-0 z-40 bg-[#1c1a18]/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="sheet-enter fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-[#fbfaf6] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e0d8cc] bg-[#fbfaf6] px-6 py-4">
          <h2 className="t-strong text-[#4a4036]">รายละเอียด</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#b0a396] transition-colors hover:bg-[#f4f3ee]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="t-caption text-[#b0a396] mb-1">หัวข้อ</p>
            <p className="t-strong text-[#4a4036]">{event.title}</p>
          </div>

          {event.description && (
            <div>
              <p className="t-caption text-[#b0a396] mb-1">รายละเอียด</p>
              <p className="t-body text-[#4a4036]">{event.description}</p>
            </div>
          )}

          <div>
            <p className="t-caption text-[#b0a396] mb-1">วันที่</p>
            <p className="t-body text-[#4a4036]">
              {formatDateThai(event.eventDate)}
            </p>
          </div>

          <div>
            <p className="t-caption text-[#b0a396] mb-1">เวลา</p>
            <p className="t-body text-[#4a4036]">
              {event.eventTime ? `${event.eventTime.slice(0, 5)} น.` : "ตลอดวัน"}
            </p>
          </div>

          <div>
            <p className="t-caption text-[#b0a396] mb-1">สถานะ</p>
            <p className="t-body text-[#4a4036]">
              {event.status === "pending" && "กำลังรอ"}
              {event.status === "sent" && "ส่งแล้ว"}
              {event.status === "cancelled" && "ยกเลิกแล้ว"}
            </p>
          </div>

          <button
            onClick={handleDelete}
            disabled={deleting || event.status !== "pending"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-3 t-body font-semibold text-red-600 transition-colors hover:bg-red-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={16} />
            {deleting ? "กำลังลบ..." : "ลบเตือนความจำ"}
          </button>
        </div>
      </div>
    </>
  );
}

function formatDateThai(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const thaiMonths = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `${day} ${thaiMonths[month - 1]} ${year + 543}`;
}
