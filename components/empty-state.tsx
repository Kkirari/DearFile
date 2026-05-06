export function EmptyState() {
  return (
    <div className="page-fade flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="relative mb-6">
        <div className="flex h-24 w-24 items-center justify-center rounded-[28px] border border-[#e0d8cc] bg-white shadow-sm">
          <span className="text-4xl">📂</span>
        </div>
        <div className="absolute -bottom-1.5 -right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#06C755] shadow-md">
          <span className="text-[11px] font-black text-white">L</span>
        </div>
      </div>

      <h2 className="text-base font-bold text-[#4a4036]">ยังไม่มีไฟล์</h2>
      <p className="mt-2 max-w-[240px] text-sm leading-relaxed text-[#b0a396]">
        ส่งไฟล์มาใน LINE OA ของเรา แล้วไฟล์จะปรากฏที่นี่โดยอัตโนมัติ
      </p>

      <div className="mt-5 flex items-center gap-2 rounded-xl border border-[#e0d8cc] bg-white px-5 py-3 shadow-sm">
        <span className="text-sm">📎</span>
        <p className="text-xs text-[#b0a396]">
          รูปภาพ, วิดีโอ, เอกสาร, PDF และอื่นๆ
        </p>
      </div>
    </div>
  );
}
