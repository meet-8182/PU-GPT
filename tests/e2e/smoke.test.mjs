import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function takeConsoleLogs(page) {
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    const text = m.text().slice(0, 200);
    if (m.type() === 'error') errors.push(text);
    else if (m.type() === 'warning') warnings.push(text);
  });
  page.on('pageerror', (e) => warnings.push('pageerror: ' + e.message));
  return { errors, warnings };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = {};

  // === STUDENT ===
  const studentPage = await browser.newPage();
  results.student_console = takeConsoleLogs(studentPage);
  await login(studentPage, 'student@test.com', 'password123');
  results.student_url_after_login = studentPage.url();
  // No blank white screen - check body has content
  const studentBody = await studentPage.textContent('body');
  results.student_has_content = studentBody !== null && studentBody.length > 0;
  // Ask page has composer
  results.student_has_composer = await studentPage.locator('textarea').count() > 0;
  // History should be accessible
  await studentPage.click('button[aria-controls="history-dropdown"]');
  await page.waitForTimeout(500);
  results.student_history_dropdown_items = await studentPage.locator('#history-dropdown button').count();
  await studentPage.close();

  // === TEACHER ===
  const teacherPage = await browser.newPage();
  results.teacher_console = takeConsoleLogs(teacherPage);
  await login(teacherPage, 'teacher@pu.edu', 'password123');
  results.teacher_url_after_login = teacherPage.url();
  const teacherBody = await teacherPage.textContent('body');
  results.teacher_has_content = teacherBody !== null && teacherBody.length > 0;
  // Library page
  results.teacher_library_nav = await teacherPage.locator('text=Library').count() > 0;
  await teacherPage.close();

  // === ADMIN ===
  const adminPage = await browser.newPage();
  results.admin_console = takeConsoleLogs(adminPage);
  await login(adminPage, 'admin@pu.edu', 'password123');
  results.admin_url_after_login = adminPage.url();
  const adminBody = await adminPage.textContent('body');
  results.admin_has_content = adminBody !== null && adminBody.length > 0;
  // Admin dashboard
  results.admin_dashboard_nav = await adminPage.locator('text=Dashboard').count() > 0;
  // Admin status page
  await adminPage.goto(`${BASE}/admin/status`, { waitUntil: 'networkidle' });
  results.admin_status_page_loads = adminPage.url().includes('/admin/status');
  // Admin insights page
  await adminPage.goto(`${BASE}/admin/insights`, { waitUntil: 'networkidle' });
  results.admin_insights_page_loads = adminPage.url().includes('/admin/insights');
  await adminPage.close();

  // === TEACHER: Document upload flow (basic) ===
  const teacherUploadPage = await browser.newPage();
  results.teacher_upload_console = takeConsoleLogs(teacherUploadPage);
  await login(teacherUploadPage, 'teacher@pu.edu', 'password123');
  // Navigate to library
  await teacherPage.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  results.teacher_library_loads = teacherUploadPage.url().includes('/library');
  // Check for upload area
  results.teacher_upload_area = await teacherUploadPage.locator('text=Content Library').count() > 0;
  await teacherUploadPage.close();

  // === ADMIN: System Status page ===
  // Already covered above

  await browser.close();

  // Print summary
  console.log('=== PLAYWRIGHT SMOKE SUITE RESULTS ===');
  for (const [key, val] of Object.entries(results)) {
    if (typeof val === 'boolean') {
      console.log(`  ${key}: ${val ? 'PASS' : 'FAIL'}`);
    } else if (typeof val === 'number') {
      console.log(`  ${key}: ${val}`);
    } else {
      console.log(`  ${key}: ${JSON.stringify(val).slice(0, 100)}`);
    }
  }

  const allPassed = 
    results.student_has_content &&
    results.student_has_composer &&
    results.teacher_has_content &&
    results.admin_has_content &&
    results.teacher_library_nav &&
    results.admin_dashboard_nav &&
    results.admin_status_page_loads &&
    results.admin_insights_page_loads &&
    results.teacher_upload_area;

  console.log(`\nOverall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});