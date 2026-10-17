/* EduCore API client. Use this module instead of localStorage for protected school records. */
(() => {
  'use strict';
  const API_BASE = '/api';
  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (['POST','PUT','PATCH','DELETE'].includes(method) && path !== '/auth/login') {
      headers['X-EduCore-Request'] = '1';
    }
    const response = await fetch(`${API_BASE}${path}`, {
      ...options, method, headers, credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.details = data.details;
      throw error;
    }
    return data;
  }
  window.EduCoreAPI = Object.freeze({
    request,
    me: () => request('/auth/me'),
    login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
    logout: () => request('/auth/logout', { method: 'POST', body: {} }),
    dashboard: () => request('/dashboard/summary'),
    students: (params = {}) => request(`/students${new URLSearchParams(params).size ? `?${new URLSearchParams(params)}` : ''}`),
    createStudent: (student) => request('/students', { method: 'POST', body: student }),
    updateStudent: (id, student) => request(`/students/${encodeURIComponent(id)}`, { method: 'PUT', body: student }),
    deleteStudent: (id) => request(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    teachers: () => request('/teachers'),
    createTeacher: (teacher) => request('/teachers', { method: 'POST', body: teacher }),
    updateTeacher: (id, teacher) => request(`/teachers/${encodeURIComponent(id)}`, { method: 'PUT', body: teacher }),
    deleteTeacher: (id) => request(`/teachers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    attendance: (date) => request(`/attendance?date=${encodeURIComponent(date)}`),
    saveAttendance: (date, records) => request('/attendance', { method: 'POST', body: { date, records } }),
    results: () => request('/results'),
    createResult: (result) => request('/results', { method: 'POST', body: result }),
    deleteResult: (id) => request(`/results/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    fees: () => request('/fees'),
    createFee: (fee) => request('/fees', { method: 'POST', body: fee }),
    updateFee: (id, fee) => request(`/fees/${encodeURIComponent(id)}`, { method: 'PUT', body: fee }),
    announcements: () => request('/announcements'),
    createAnnouncement: (announcement) => request('/announcements', { method: 'POST', body: announcement }),
    deleteAnnouncement: (id) => request(`/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    settings: () => request('/school/settings'),
    updateSettings: (settings) => request('/school/settings', { method: 'PUT', body: settings })
  });
})();
