/**
 * Calendar tab — simple list view of upcoming reminders.
 * Groups by "today", "tomorrow", and future dates.
 */

"use client";

import { useState } from "react";
import { Calendar, Clock, Trash2, X } from "lucide-react";
import { useCalendarEvents } from "@/hooks/use-calendar-events";
import type { CalendarEvent } from "@/lib/db";

interface CalendarTabProps {
  userId: string;
}

export function CalendarTab({ userId }: CalendarTabProps) {
  const { events, loading, error, cancelEvent } = useCalendarEvents(userId);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

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

  // Group events by date
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const todayEvents = events.filter((e) => e.eventDate === today);
  const tomorrowEvents = events.filter((e) => e.eventDate === tomorrow);
  const futureEvents = events.filter((e) => e.eventDate > tomorrow);

  const hasEvents = events.length > 0;

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
      <div className="mx-auto max-w-2xl px-4 py-6">
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

        {/* Today */}
        {todayEvents.length > 0 && (
          <div className="mb-6">
            <h2 className="t-strong text-[#4a4036] mb-3">วันนี้</h2>
            <div className="space-y-2">
              {todayEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => setSelectedEvent(event)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Tomorrow */}
        {tomorrowEvents.length > 0 && (
          <div className="mb-6">
            <h2 className="t-strong text-[#4a4036] mb-3">
              พรุ่งนี้ ({formatDateThai(tomorrow)})
            </h2>
            <div className="space-y-2">
              {tomorrowEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => setSelectedEvent(event)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Future */}
        {futureEvents.length > 0 && (
          <div className="mb-6">
            <h2 className="t-strong text-[#4a4036] mb-3">กำหนดการต่อไป</h2>
            <div className="space-y-2">
              {futureEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => setSelectedEvent(event)}
                  showDate
                />
              ))}
            </div>
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

interface EventCardProps {
  event: CalendarEvent;
  onClick: () => void;
  showDate?: boolean;
}

function EventCard({ event, onClick, showDate }: EventCardProps) {
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
            {showDate && `${formatDateThai(event.eventDate)} • `}
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
  return `${day} ${thaiMonths[month - 1]}`;
}
