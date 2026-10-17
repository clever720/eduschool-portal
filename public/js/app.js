
/* EduCore application. Existing school-management features preserved. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    user: null,
    students: [],
    teachers: [],
    attendance: [],
    results: [],
    fees: [],
    announcements: [],
    page: 'dashboard'
  };

  const money = value =>
    new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 2
    }).format(Number(value || 0));

  const escapeHTML = value =>
    String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);

  const dateToday = () => new Date().toISOString().slice(0, 10);
  let toastTimer;

  function toast(message, bad = false) {
    const el = $('#toast');
    if (!el) return;

    el.textContent = message;
    el.classList.remove('hidden');
    el.style.background = bad ? '#9d252c' : '#132344';

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function notice(message, bad = false) {
    const el = $('#notice');
    if (!el) return;

    el.textContent = message;
    el.classList.toggle('bad', bad);
    el.classList.remove('hidden');

    setTimeout(() => el.classList.add('hidden'), 5000);
  }

  async function run(action, successMessage) {
    try {
      const result = await action();
      if (successMessage) toast(successMessage);
      return result;
    } catch (e) {
      if (e.status === 401) {
        showLogin();
        return null;
      }

      toast(e.message || 'Something went wrong.', true);
      return null;
    }
  }

  function showLogin() {
    $('#login-screen')?.classList.remove('hidden');
    $('#app-shell')?.classList.add('hidden');
    state.user = null;
  }

  function showApp(user) {
    state.user = user;

    $('#login-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');

    $('#user-name').textContent = user.name;
    $('#user-role').textContent = user.role;
    $('#user-avatar').textContent =
      (user.name || 'E').trim().charAt(0).toUpperCase();
    $('#welcome-name').textContent =
      (user.name || 'Administrator').split(' ')[0];
    $('#school-name').textContent = user.schoolName || 'Your School';
    $('#today-label').textContent =
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
        .format(new Date());

    applyPermissions();
    navigate('dashboard');

    loadDashboard();
    loadStudents();
    loadTeachers();
    loadAttendance();
    loadResults();
    loadFees();
    loadAnnouncements();
    loadSettings();
  }

  function applyPermissions() {
    if (!state.user) return;

    const role = state.user.role;

    $$('[data-admin-only]').forEach(el => {
      el.classList.toggle('hidden', role !== 'admin');
    });

    if (role !== 'admin') {
      $('#toggle-teacher-form')?.classList.add('hidden');
      $('#toggle-student-form')?.classList.add('hidden');
    }

    if (role === 'teacher') {
      $('#fee-form')?.classList.add('hidden');
    }

    if (!['admin', 'bursar'].includes(role)) {
      $('#page-fees')?.classList.add('hidden');
      $$('[data-page="fees"]').forEach(el => el.classList.add('hidden'));
    }

    if (role !== 'admin') {
      $('#page-settings')?.classList.add('hidden');
      $$('[data-page="settings"]').forEach(el => el.classList.add('hidden'));
    }
  }

  const titles = {
    dashboard: ['Dashboard', 'OVERVIEW'],
    students: ['Students', 'SCHOOL RECORDS'],
    teachers: ['Teachers', 'SCHOOL RECORDS'],
    attendance: ['Attendance', 'DAILY OPERATIONS'],
    results: ['Exam results', 'ACADEMICS'],
    fees: ['School fees', 'FINANCE'],
    announcements: ['Announcements', 'COMMUNICATION'],
    settings: ['School settings', 'ADMINISTRATION']
  };

  function navigate(page) {
    if (!titles[page]) return;

    // Prevent navigating to pages hidden for the current role.
    const pageButton = $(`[data-page="${page}"]`);
    if (pageButton?.classList.contains('hidden')) return;

    state.page = page;

    $$('.page').forEach(el => {
      el.classList.toggle('hidden', el.id !== `page-${page}`);
    });

    $$('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    $('#page-heading').textContent = titles[page][0];
    $('#breadcrumb').textContent = titles[page][1];
    $('#sidebar').classList.remove('open');
  }

  function bindNavigation() {
    $('#main-nav').addEventListener('click', e => {
      const button = e.target.closest('[data-page]');
      if (button) navigate(button.dataset.page);
    });

    $('#mobile-menu').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
    });

    $('#logout-button').addEventListener('click', async () => {
      await run(() => EduCoreAPI.logout());
      showLogin();
      $('#password').value = '';
    });
  }

  async function loadDashboard() {
    const data = await run(() => EduCoreAPI.dashboard());
    if (!data) return;

    const summary = data.summary;

    $('#stat-students').textContent = summary.students;
    $('#stat-teachers').textContent = summary.teachers;
    $('#stat-results').textContent = summary.results;
    $('#stat-present').textContent = summary.present;

    $('#fees-total').textContent = money(summary.feesDue);
    $('#fees-paid').textContent = money(summary.feesPaid);
    $('#fees-outstanding').textContent = money(summary.feesOutstanding);

    $('#dashboard-announcements').innerHTML =
      summary.announcements.length
        ? summary.announcements.map(a =>
            `<div class="stack-item">
              <strong>${escapeHTML(a.title)}</strong>
              <p>${escapeHTML(a.message)}</p>
            </div>`
          ).join('')
        : 'No announcements yet.';
  }

  // ---------------------------------------------------------
  // STUDENTS
  // ---------------------------------------------------------

  function studentPayload() {
    return {
      admission_number: $('#student-admission').value.trim(),
      full_name: $('#student-name').value.trim(),
      class_name: $('#student-class').value.trim(),
      gender: $('#student-gender').value,
      date_of_birth: $('#student-dob').value,
      parent_name: $('#parent-name').value.trim(),
      parent_phone: $('#parent-phone').value.trim(),
      parent_email: $('#parent-email').value.trim()
    };
  }

  async function loadStudents() {
    const data = await run(() =>
      EduCoreAPI.students({
        search: $('#student-search')?.value || '',
        className: $('#student-class-filter')?.value || ''
      })
    );

    if (!data) return;

    state.students = data.students;
    renderStudents();
    fillStudentSelects();
  }

  function renderStudents() {
    const tbody = $('#students-table');

    if (!state.students.length) {
      tbody.innerHTML = '<tr><td colspan="6">No students found.</td></tr>';
      return;
    }

    tbody.innerHTML = state.students.map(s => `
      <tr>
        <td>${escapeHTML(s.admission_number)}</td>
        <td><strong>${escapeHTML(s.full_name)}</strong></td>
        <td>${escapeHTML(s.class_name)}</td>
        <td>${escapeHTML(s.parent_name || '—')}</td>
        <td>${escapeHTML(s.parent_phone || s.parent_email || '—')}</td>
        <td>
          ${['admin', 'teacher'].includes(state.user.role)
            ? `<button class="table-action" data-edit-student="${s.id}">Edit</button>`
            : ''}
          ${state.user.role === 'admin'
            ? `<button class="table-action danger" data-delete-student="${s.id}">Delete</button>`
            : ''}
        </td>
      </tr>
    `).join('');
  }

  function fillStudentSelects() {
    for (const id of ['#result-student', '#fee-student']) {
      const element = $(id);
      if (!element) continue;

      const oldValue = element.value;

      element.innerHTML =
        '<option value="">Choose a student</option>' +
        state.students.map(s =>
          `<option value="${s.id}">
            ${escapeHTML(s.full_name)} — ${escapeHTML(s.admission_number)}
          </option>`
        ).join('');

      if (oldValue) element.value = oldValue;
    }
  }

  function resetStudentForm() {
    $('#student-form').reset();
    $('#student-id').value = '';
    $('#student-form').classList.add('hidden');
    $('#toggle-student-form').textContent = '+ Add student';
  }

  function setupStudents() {
    $('#toggle-student-form').addEventListener('click', () => {
      const form = $('#student-form');
      form.classList.toggle('hidden');

      $('#toggle-student-form').textContent =
        form.classList.contains('hidden') ? '+ Add student' : 'Close form';
    });

    $('#cancel-student').addEventListener('click', resetStudentForm);

    $('#student-form').addEventListener('submit', async e => {
      e.preventDefault();

      const id = $('#student-id').value;

      const result = await run(
        () => id
          ? EduCoreAPI.updateStudent(id, studentPayload())
          : EduCoreAPI.createStudent(studentPayload()),
        id ? 'Student updated.' : 'Student added.'
      );

      if (result) {
        resetStudentForm();
        await loadStudents();
        await loadDashboard();
      }
    });

    const refresh = () => loadStudents();

    $('#student-search').addEventListener('input', debounce(refresh, 300));
    $('#student-class-filter').addEventListener('input', debounce(refresh, 300));
    $('#refresh-students').addEventListener('click', refresh);

    $('#students-table').addEventListener('click', async e => {
      const edit = e.target.closest('[data-edit-student]');
      const del = e.target.closest('[data-delete-student]');

      if (edit) {
        const student = state.students.find(
          item => item.id === edit.dataset.editStudent
        );

        if (!student) return;

        $('#student-id').value = student.id;
        $('#student-admission').value = student.admission_number;
        $('#student-name').value = student.full_name;
        $('#student-class').value = student.class_name;
        $('#student-gender').value = student.gender || '';
        $('#student-dob').value = student.date_of_birth
          ? String(student.date_of_birth).slice(0, 10)
          : '';
        $('#parent-name').value = student.parent_name || '';
        $('#parent-phone').value = student.parent_phone || '';
        $('#parent-email').value = student.parent_email || '';

        $('#student-form').classList.remove('hidden');
        $('#toggle-student-form').textContent = 'Close form';

        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      if (del && confirm(
        'Permanently delete this student and linked attendance, results, and fee records?'
      )) {
        const result = await run(
          () => EduCoreAPI.deleteStudent(del.dataset.deleteStudent),
          'Student deleted.'
        );

        if (result !== null) {
          await loadStudents();
          await loadDashboard();
        }
      }
    });
  }

  // ---------------------------------------------------------
  // TEACHERS AND TEACHER LOGIN ACCOUNTS
  // ---------------------------------------------------------

  async function loadTeachers() {
    const data = await run(() => EduCoreAPI.teachers());
    if (!data) return;

    state.teachers = data.teachers;
    renderTeachers();
  }

  function renderTeachers() {
    const tbody = $('#teachers-table');

    if (!state.teachers.length) {
      tbody.innerHTML = '<tr><td colspan="6">No teachers added yet.</td></tr>';
      return;
    }

    tbody.innerHTML = state.teachers.map(t => `
      <tr>
        <td>${escapeHTML(t.staff_number || '—')}</td>
        <td><strong>${escapeHTML(t.full_name)}</strong></td>
        <td>${escapeHTML(t.department || '—')}</td>
        <td>${escapeHTML(t.email || '—')}</td>
        <td>${escapeHTML(t.phone || '—')}</td>
        <td>
          ${state.user.role === 'admin'
            ? `<button class="table-action" data-edit-teacher="${t.id}">Edit</button>
               <button class="table-action danger" data-delete-teacher="${t.id}">Delete</button>`
            : ''}
        </td>
      </tr>
    `).join('');
  }

  function teacherPayload(includePassword = false) {
    const payload = {
      staff_number: $('#teacher-staff-number').value.trim(),
      full_name: $('#teacher-name').value.trim(),
      department: $('#teacher-department').value.trim(),
      email: $('#teacher-email').value.trim(),
      phone: $('#teacher-phone').value.trim()
    };

    // Password is sent only when creating a new teacher account.
    if (includePassword) {
      payload.password = $('#teacher-password').value;
    }

    return payload;
  }

  function setupTeachers() {
    const passwordInput = $('#teacher-password');

    if (passwordInput) {
      passwordInput.required = true;
      passwordInput.autocomplete = 'new-password';
      passwordInput.minLength = 12;
    }

    $('#toggle-teacher-form').addEventListener('click', () => {
      const form = $('#teacher-form');
      form.classList.toggle('hidden');

      if (!form.classList.contains('hidden') && !$('#teacher-id').value) {
        if (passwordInput) passwordInput.required = true;
      }
    });

    $('#cancel-teacher').addEventListener('click', () => {
      $('#teacher-form').reset();
      $('#teacher-id').value = '';
      $('#teacher-form').classList.add('hidden');

      if (passwordInput) {
        passwordInput.required = true;
        passwordInput.value = '';
      }
    });

    $('#teacher-form').addEventListener('submit', async e => {
      e.preventDefault();

      const id = $('#teacher-id').value;

      if (!id && passwordInput && passwordInput.value.length < 12) {
        toast('The teacher password must be at least 12 characters.', true);
        passwordInput.focus();
        return;
      }

      const payload = teacherPayload(!id);

      const result = await run(
        () => id
          ? EduCoreAPI.updateTeacher(id, payload)
          : EduCoreAPI.createTeacher(payload),
        id
          ? 'Teacher updated.'
          : 'Teacher account created successfully.'
      );

      if (result) {
        $('#teacher-form').reset();
        $('#teacher-id').value = '';
        $('#teacher-form').classList.add('hidden');

        if (passwordInput) passwordInput.required = true;

        await loadTeachers();
        await loadDashboard();
      }
    });

    $('#teachers-table').addEventListener('click', async e => {
      const edit = e.target.closest('[data-edit-teacher]');
      const del = e.target.closest('[data-delete-teacher]');

      if (edit) {
        const teacher = state.teachers.find(
          item => item.id === edit.dataset.editTeacher
        );

        if (!teacher) return;

        $('#teacher-id').value = teacher.id;
        $('#teacher-staff-number').value = teacher.staff_number || '';
        $('#teacher-name').value = teacher.full_name;
        $('#teacher-department').value = teacher.department || '';
        $('#teacher-email').value = teacher.email || '';
        $('#teacher-phone').value = teacher.phone || '';

        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.required = false;
        }

        $('#teacher-form').classList.remove('hidden');
      }

      if (del && confirm('Delete this teacher record?')) {
        const result = await run(
          () => EduCoreAPI.deleteTeacher(del.dataset.deleteTeacher),
          'Teacher deleted.'
        );

        if (result !== null) {
          await loadTeachers();
          await loadDashboard();
        }
      }
    });
  }

  // ---------------------------------------------------------
  // ATTENDANCE
  // ---------------------------------------------------------

  async function loadAttendance() {
    if (!$('#attendance-date')) return;

    $('#attendance-date').value =
      $('#attendance-date').value || dateToday();

    const data = await run(() =>
      EduCoreAPI.attendance($('#attendance-date').value)
    );

    if (!data) return;

    state.attendance = data.attendance;

    $('#attendance-table').innerHTML = data.attendance.length
      ? data.attendance.map(a => `
          <tr data-student-id="${a.student_id}">
            <td>
              <strong>${escapeHTML(a.full_name)}</strong>
              <small class="muted">${escapeHTML(a.admission_number)}</small>
            </td>
            <td>${escapeHTML(a.class_name)}</td>
            <td>
              <select class="attendance-status">
                <option value="present" ${a.status === 'present' ? 'selected' : ''}>Present</option>
                <option value="absent" ${a.status === 'absent' ? 'selected' : ''}>Absent</option>
                <option value="late" ${a.status === 'late' ? 'selected' : ''}>Late</option>
                <option value="excused" ${a.status === 'excused' ? 'selected' : ''}>Excused</option>
              </select>
            </td>
          </tr>
        `).join('')
      : '<tr><td colspan="3">Add students before taking attendance.</td></tr>';

    $('#attendance-count').textContent =
      `${data.attendance.length} student(s)`;
  }

  function setupAttendance() {
    $('#attendance-date').addEventListener('change', loadAttendance);

    $('#save-attendance').addEventListener('click', async () => {
      const records = $$('#attendance-table tr[data-student-id]').map(tr => ({
        student_id: tr.dataset.studentId,
        status: $('.attendance-status', tr).value
      }));

      if (!records.length) {
        return toast('There are no students to save.', true);
      }

      const result = await run(
        () => EduCoreAPI.saveAttendance($('#attendance-date').value, records),
        'Attendance saved.'
      );

      if (result) loadDashboard();
    });
  }

  // ---------------------------------------------------------
  // EXAM RESULTS
  // ---------------------------------------------------------

  async function loadResults() {
    const data = await run(() => EduCoreAPI.results());
    if (!data) return;

    state.results = data.results;
    renderResults();
  }

  function renderResults() {
    const tbody = $('#results-table');

    if (!state.results.length) {
      tbody.innerHTML = '<tr><td colspan="7">No exam results yet.</td></tr>';
      return;
    }

    tbody.innerHTML = state.results.map(r => `
      <tr>
        <td>${escapeHTML(r.full_name || 'Student')}</td>
        <td>${escapeHTML(r.class_name || '—')}</td>
        <td>${escapeHTML(r.subject)}</td>
        <td>${escapeHTML(r.term)}</td>
        <td>${escapeHTML(r.academic_session)}</td>
        <td><strong>${Number(r.score).toFixed(2)}%</strong></td>
        <td>
          ${state.user.role === 'admin'
            ? `<button class="table-action danger" data-delete-result="${r.id}">Delete</button>`
            : ''}
        </td>
      </tr>
    `).join('');
  }

  function setupResults() {
    $('#result-form').addEventListener('submit', async e => {
      e.preventDefault();

      const payload = {
        student_id: $('#result-student').value,
        subject: $('#result-subject').value.trim(),
        term: $('#result-term').value,
        academic_session: $('#result-session').value.trim(),
        score: Number($('#result-score').value)
      };

      const result = await run(
        () => EduCoreAPI.createResult(payload),
        'Result saved.'
      );

      if (result) {
        $('#result-subject').value = '';
        $('#result-score').value = '';
        await loadResults();
        await loadDashboard();
      }
    });

    $('#results-table').addEventListener('click', async e => {
      const button = e.target.closest('[data-delete-result]');

      if (button && confirm('Delete this result?')) {
        const result = await run(
          () => EduCoreAPI.deleteResult(button.dataset.deleteResult),
          'Result deleted.'
        );

        if (result !== null) {
          await loadResults();
          await loadDashboard();
        }
      }
    });
  }

  // ---------------------------------------------------------
  // SCHOOL FEES
  // ---------------------------------------------------------

  async function loadFees() {
    if (!state.user || !['admin', 'bursar'].includes(state.user.role)) return;

    const data = await run(() => EduCoreAPI.fees());
    if (!data) return;

    state.fees = data.fees;
    const tbody = $('#fees-table');

    if (!data.fees.length) {
      tbody.innerHTML = '<tr><td colspan="7">No fee records yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.fees.map(f => `
      <tr>
        <td>${escapeHTML(f.full_name)}</td>
        <td>${escapeHTML(f.class_name)}</td>
        <td>${escapeHTML(f.description)}</td>
        <td>${money(f.amount_due)}</td>
        <td>${money(f.amount_paid)}</td>
        <td><strong>${money(Number(f.amount_due) - Number(f.amount_paid))}</strong></td>
        <td>${f.due_date ? escapeHTML(String(f.due_date).slice(0, 10)) : '—'}</td>
      </tr>
    `).join('');
  }

  function setupFees() {
    $('#fee-form').addEventListener('submit', async e => {
      e.preventDefault();

      const payload = {
        student_id: $('#fee-student').value,
        description: $('#fee-description').value.trim(),
        amount_due: Number($('#fee-due').value),
        amount_paid: Number($('#fee-paid').value),
        due_date: $('#fee-date').value
      };

      const result = await run(
        () => EduCoreAPI.createFee(payload),
        'Fee record saved.'
      );

      if (result) {
        $('#fee-form').reset();
        $('#fee-paid').value = '0';
        await loadFees();
        await loadDashboard();
      }
    });
  }

  // ---------------------------------------------------------
  // ANNOUNCEMENTS
  // ---------------------------------------------------------

  async function loadAnnouncements() {
    const data = await run(() => EduCoreAPI.announcements());
    if (!data) return;

    state.announcements = data.announcements;

    $('#announcement-list').innerHTML = data.announcements.length
      ? data.announcements.map(a => `
          <article class="panel stack-item">
            <strong>${escapeHTML(a.title)}</strong>
            <p>${escapeHTML(a.message).replace(/\n/g, '<br>')}</p>
            <small class="muted">${escapeHTML(String(a.created_at).slice(0, 10))}</small>
            ${state.user.role === 'admin'
              ? `<p><button class="table-action danger" data-delete-announcement="${a.id}">Delete</button></p>`
              : ''}
          </article>
        `).join('')
      : '<div class="panel muted">No announcements published yet.</div>';
  }

  function setupAnnouncements() {
    $('#announcement-form').addEventListener('submit', async e => {
      e.preventDefault();

      const result = await run(
        () => EduCoreAPI.createAnnouncement({
          title: $('#announcement-title').value.trim(),
          message: $('#announcement-message').value.trim()
        }),
        'Announcement published.'
      );

      if (result) {
        $('#announcement-form').reset();
        await loadAnnouncements();
        await loadDashboard();
      }
    });

    $('#announcement-list').addEventListener('click', async e => {
      const button = e.target.closest('[data-delete-announcement]');

      if (button && confirm('Delete this announcement?')) {
        const result = await run(
          () => EduCoreAPI.deleteAnnouncement(button.dataset.deleteAnnouncement),
          'Announcement deleted.'
        );

        if (result !== null) {
          await loadAnnouncements();
          await loadDashboard();
        }
      }
    });
  }

  // ---------------------------------------------------------
  // SCHOOL SETTINGS
  // ---------------------------------------------------------

  async function loadSettings() {
    if (!state.user || state.user.role !== 'admin') {
      $('[data-page="settings"]')?.classList.add('hidden');
      return;
    }

    const data = await run(() => EduCoreAPI.settings());
    if (!data) return;

    const settings = data.settings;

    $('#school-name-input').value = settings.name || '';
    $('#school-email').value = settings.email || '';
    $('#school-phone').value = settings.phone || '';
    $('#school-address').value = settings.address || '';
    $('#academic-session').value = settings.academic_session || '2026/2027';
    $('#academic-term').value = settings.academic_term || 'First Term';
    $('#school-name').textContent = settings.name || state.user.schoolName;
  }

  function setupSettings() {
    $('#settings-form').addEventListener('submit', async e => {
      e.preventDefault();

      const settings = {
        name: $('#school-name-input').value.trim(),
        email: $('#school-email').value.trim(),
        phone: $('#school-phone').value.trim(),
        address: $('#school-address').value.trim(),
        academic_session: $('#academic-session').value.trim(),
        academic_term: $('#academic-term').value
      };

      const data = await run(
        () => EduCoreAPI.updateSettings(settings),
        'School settings saved.'
      );

      if (data) {
        $('#school-name').textContent = data.settings.name;
        state.user.schoolName = data.settings.name;
      }
    });
  }

  // ---------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------

  function setupLogin() {
    $('#login-form').addEventListener('submit', async e => {
      e.preventDefault();
      $('#login-error').textContent = '';

      const button = $('button[type="submit"]', e.currentTarget);
      if (button) {
        button.disabled = true;
        button.textContent = 'Signing in…';
      }

      try {
        const data = await EduCoreAPI.login(
          $('#email').value.trim(),
          $('#password').value
        );

        $('#password').value = '';
        showApp(data.user);
      } catch (error) {
        $('#login-error').textContent =
          error.message || 'Unable to sign in.';
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = 'Sign in securely';
        }
      }
    });
  }

  // ---------------------------------------------------------
  // PARENT AND STUDENT SELF-REGISTRATION
  // ---------------------------------------------------------

  function showRegistrationMessage(message, bad = false) {
    const element = $('#signup-message');

    if (!element) {
      toast(message, bad);
      return;
    }

    element.textContent = message;
    element.classList.toggle('bad', bad);
    element.classList.remove('hidden');
    element.setAttribute('role', 'status');
  }

  async function loadRegistrationSchools() {
    const selects = [
      $('#parent-school'),
      $('#student-school')
    ].filter(Boolean);

    if (!selects.length) return;

    try {
      const response = await EduCoreAPI.schools();
      const schools = Array.isArray(response)
        ? response
        : response.schools || [];

      selects.forEach(select => {
        select.replaceChildren();

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select your school';
        select.appendChild(placeholder);

        schools.forEach(school => {
          const option = document.createElement('option');
          option.value = school.id;
          option.textContent = school.name;
          select.appendChild(option);
        });
      });

      if (!schools.length) {
        showRegistrationMessage(
          'No schools are currently available for registration.',
          true
        );
      }
    } catch (error) {
      console.error('Unable to load schools:', error);
      showRegistrationMessage(
        'Unable to load the school list. Please try again later.',
        true
      );
    }
  }

  function setupAccountRegistration() {
    const parentForm = $('#signup-parent-form');
    const studentForm = $('#signup-student-form');

    if (parentForm) {
      parentForm.addEventListener('submit', async event => {
        event.preventDefault();

        const submitButton = $(
          'button[type="submit"], input[type="submit"]',
          parentForm
        );

        if (submitButton) submitButton.disabled = true;

        const details = {
          schoolId: $('#parent-school', parentForm).value,
          fullName: $('#parent-full-name', parentForm).value.trim(),
          email: $('#parent-email', parentForm).value.trim(),
          password: $('#parent-password', parentForm).value,
          studentAdmissionNumber:
            $('#parent-admission-number', parentForm).value.trim()
        };

        try {
          await EduCoreAPI.registerParent(details);
          parentForm.reset();

          showRegistrationMessage(
            'Your registration has been received. Your school must verify your account before you can sign in.'
          );
        } catch (error) {
          showRegistrationMessage(
            error.message || 'Parent registration failed.',
            true
          );
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
    }

    if (studentForm) {
      studentForm.addEventListener('submit', async event => {
        event.preventDefault();

        const submitButton = $(
          'button[type="submit"], input[type="submit"]',
          studentForm
        );

        if (submitButton) submitButton.disabled = true;

        const details = {
          schoolId: $('#student-school', studentForm).value,
          fullName: $('#student-full-name', studentForm).value.trim(),
          email: $('#student-email', studentForm).value.trim(),
          password: $('#student-password', studentForm).value,
          admissionNumber:
            $('#student-admission-number', studentForm).value.trim(),
          dateOfBirth: $('#student-dob', studentForm).value
        };

        try {
          await EduCoreAPI.registerStudent(details);
          studentForm.reset();

          showRegistrationMessage(
            'Your registration has been received. Your school must verify your account before you can sign in.'
          );
        } catch (error) {
          showRegistrationMessage(
            error.message || 'Student registration failed.',
            true
          );
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
    }

    loadRegistrationSchools();
  }

  // ---------------------------------------------------------
  // HELPERS AND STARTUP
  // ---------------------------------------------------------

  function debounce(fn, wait) {
    let timer;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  async function boot() {
    setupLogin();
    setupAccountRegistration();
    bindNavigation();
    setupStudents();
    setupTeachers();
    setupAttendance();
    setupResults();
    setupFees();
    setupAnnouncements();
    setupSettings();

    try {
      const data = await EduCoreAPI.me();

      if (data.user) {
        showApp(data.user);
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
