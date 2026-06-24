/**
 * Test suite for folder command parsing logic
 * Run: node test-folder-commands.js
 */

function parseFolderCommand(text) {
  const t = text.trim();

  // Strip leading sigil + trigger if present
  const sigilMatch = t.match(/^[!/@]?\s*(?:น้องกวาง|dearfile)\s+/i);
  const rest = sigilMatch ? t.slice(sigilMatch[0].length).trim() : t;

  // English: "create folder Name"
  const enMatch = rest.match(/^create\s+folder\s+(.+)$/i);
  if (enMatch) return enMatch[1].trim();

  // Direct command: "/folder Name", "/new folder Name"
  const directMatch = rest.match(/^\/?\s*(?:new\s+)?folder\s+(.+)$/i);
  if (directMatch) return directMatch[1].trim();

  // Thai: flexible matching for common variants
  // สร้างโฟลเดอร์, สร้างโฟเดอ, โฟลเดอร์, โฟเดอ, etc.
  const thaiMatch = rest.match(/^(?:สร้าง)?(?:โฟลเดอร์|โฟเดอร์|โฟลเดอ|โฟเดอ|โฟลเด่อ)\s+(.+)$/i);
  if (thaiMatch) return thaiMatch[1].trim();

  return null;
}

// Test cases
const tests = [
  // Thai with bot trigger
  { input: '!น้องกวาง สร้างโฟลเดอร์ โปรเจกต์A', expected: 'โปรเจกต์A' },
  { input: '@น้องกวาง สร้างโฟเดอ รูปแมว', expected: 'รูปแมว' },
  { input: '/น้องกวาง สร้างโฟลเด่อ การบ้าน', expected: 'การบ้าน' },
  { input: 'น้องกวาง โฟลเดอร์ ใบเสร็จ', expected: 'ใบเสร็จ' },
  { input: '!น้องกวาง โฟเดอ เอกสาร', expected: 'เอกสาร' },

  // English with bot trigger
  { input: '!dearfile create folder ProjectA', expected: 'ProjectA' },
  { input: '@dearfile create folder Photos', expected: 'Photos' },
  { input: '/dearfile create folder Receipts 2024', expected: 'Receipts 2024' },
  { input: 'dearfile create folder Work Documents', expected: 'Work Documents' },

  // Direct commands (no bot trigger)
  { input: '/folder MyFolder', expected: 'MyFolder' },
  { input: '/new folder Documents', expected: 'Documents' },
  { input: 'folder TestFolder', expected: 'TestFolder' },

  // Should NOT match
  { input: '!น้องกวาง หารูปแมว', expected: null },
  { input: 'สร้าง folder', expected: null },
  { input: '!dearfile', expected: null },
  { input: 'random text', expected: null },
  { input: '', expected: null },
  { input: '!น้องกวาง สร้างโฟลเดอร์', expected: null }, // no name
];

console.log('🧪 Testing Folder Command Parser\n');

let passed = 0;
let failed = 0;

tests.forEach(({ input, expected }, index) => {
  const result = parseFolderCommand(input);
  const match = result === expected;

  if (match) {
    passed++;
    console.log(`✅ Test ${index + 1}: PASS`);
  } else {
    failed++;
    console.log(`❌ Test ${index + 1}: FAIL`);
    console.log(`   Input: "${input}"`);
    console.log(`   Expected: ${expected === null ? 'null' : `"${expected}"`}`);
    console.log(`   Got: ${result === null ? 'null' : `"${result}"`}`);
  }
});

console.log(`\n📊 Results: ${passed}/${tests.length} passed, ${failed}/${tests.length} failed`);

if (failed === 0) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed');
  process.exit(1);
}
