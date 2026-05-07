export type Lang = "en" | "th";

export const t = {
  en: {
    // Nav
    navHome:    "Home",
    navSearch:  "Search",
    navFolders: "Folders",
    navProfile: "Profile",

    // Header
    greeting: "Hello",
    tagline:  "Your file storage",

    // Home tab
    browseByType:  "Browse by Type",
    myFolders:     "My Folders",
    showMore:      "Show more",
    yours:         "Yours",
    organizedByAi: "Organized by AI",
    recent:        "Recent",
    seeAll:        "See all",
    noFolders:     "No folders yet — create one in Folders tab.",
    noFiles:       "No files yet — upload one!",
    searchPlaceholder: "Search files...",
    searchTitle:       "Search",
    searchBack:        "Back",
    searchEmpty:       "Type to search your files…",
    searchNoResults:   "No results for",
    searchCategories:  "Browse by category",
    searchResultCount: "result",
    searchResultCountPlural: "results",

    // Profile
    lineAccount:   "LINE Account",
    files:         "Files",
    folders:       "Folders",
    used:          "Used",
    storage:       "Storage",
    usedSuffix:    "used",
    storageOf:     "of 500 MB",
    myFoldersLabel:  "My Folders",
    aiFolders:     "AI Organized",
    fileTypes:     "File Types",
    about:         "About",
    settings:      "Settings",
    language:      "Language",
    english:       "English",
    thai:          "Thai",
    appearance:    "Appearance",
    dark:          "Dark",
    light:         "Light",
    storageBackend: "LINE OA Cloud",
    version:       "v1.0.0",

    // File types
    images:    "Images",
    pdf:       "PDF",
    documents: "Documents",
    video:     "Video",
    audio:     "Audio",
    archive:   "Archive",
    other:     "Other",

    // Folder tab
    unsortedInbox: "Unsorted inbox",
    unsortedFiles: "unsorted files",
    createFolder:  "New Folder",
    allFolders:    "All Folders",
    noFoldersYet:  "No folders yet",
    createFirst:   "Create your first folder above.",

    // Loading & errors
    connecting:    "Connecting to LINE...",
    error:         "Error",
    errorLoading:  "Failed to load. Please try again.",
  },

  th: {
    // Nav
    navHome:    "หน้าหลัก",
    navSearch:  "ค้นหา",
    navFolders: "โฟลเดอร์",
    navProfile: "โปรไฟล์",

    // Header
    greeting: "สวัสดี",
    tagline:  "คลังไฟล์ของคุณ",

    // Home tab
    browseByType:  "เลือกตามประเภท",
    myFolders:     "โฟลเดอร์ของฉัน",
    showMore:      "ดูเพิ่มเติม",
    yours:         "ของคุณ",
    organizedByAi: "จัดโดย AI",
    recent:        "ล่าสุด",
    seeAll:        "ดูทั้งหมด",
    noFolders:     "ยังไม่มีโฟลเดอร์ — สร้างในแท็บโฟลเดอร์",
    noFiles:       "ยังไม่มีไฟล์ — อัปโหลดได้เลย!",
    searchPlaceholder: "ค้นหาไฟล์...",
    searchTitle:       "ค้นหา",
    searchBack:        "กลับ",
    searchEmpty:       "พิมพ์เพื่อค้นหาไฟล์ของคุณ…",
    searchNoResults:   "ไม่พบผลลัพธ์สำหรับ",
    searchCategories:  "เรียกดูตามหมวดหมู่",
    searchResultCount: "รายการ",
    searchResultCountPlural: "รายการ",

    // Profile
    lineAccount:   "บัญชี LINE",
    files:         "ไฟล์",
    folders:       "โฟลเดอร์",
    used:          "ใช้ไป",
    storage:       "พื้นที่จัดเก็บ",
    usedSuffix:    "ที่ใช้ไป",
    storageOf:     "จาก 500 MB",
    myFoldersLabel:  "โฟลเดอร์ของฉัน",
    aiFolders:     "จัดโดย AI",
    fileTypes:     "ประเภทไฟล์",
    about:         "เกี่ยวกับแอป",
    settings:      "การตั้งค่า",
    language:      "ภาษา",
    english:       "อังกฤษ",
    thai:          "ไทย",
    appearance:    "ธีม",
    dark:          "มืด",
    light:         "สว่าง",
    storageBackend: "LINE OA Cloud",
    version:       "v1.0.0",

    // File types
    images:    "รูปภาพ",
    pdf:       "PDF",
    documents: "เอกสาร",
    video:     "วิดีโอ",
    audio:     "เสียง",
    archive:   "ไฟล์บีบอัด",
    other:     "อื่นๆ",

    // Folder tab
    unsortedInbox: "กล่องรับไฟล์",
    unsortedFiles: "ไฟล์ยังไม่จัดหมวด",
    createFolder:  "โฟลเดอร์ใหม่",
    allFolders:    "โฟลเดอร์ทั้งหมด",
    noFoldersYet:  "ยังไม่มีโฟลเดอร์",
    createFirst:   "สร้างโฟลเดอร์แรกของคุณด้านบน",

    // Loading & errors
    connecting:    "กำลังเชื่อมต่อ LINE...",
    error:         "เกิดข้อผิดพลาด",
    errorLoading:  "ไม่สามารถโหลดได้ โปรดลองใหม่อีกครั้ง",
  },
} satisfies Record<Lang, Record<string, string>>;
