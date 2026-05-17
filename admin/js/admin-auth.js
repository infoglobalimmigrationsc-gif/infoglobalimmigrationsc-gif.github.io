/**
 * ADMIN AUTHENTICATION SYSTEM
 * Secure role-based access with JWT tokens
 */

// API Configuration
const API_URL = 'https://gisc-app-production.up.railway.app/api';
const ADMIN_API = `${API_URL}/admin`;

class AdminAuth {
    constructor() {
        this.token = localStorage.getItem('adminToken');
        this.adminData = null;
        this.sessionTimeout = 60 * 60 * 1000; // 1 hour
    }

    // Initialize admin session
    async init() {
        if (this.token) {
            return await this.validateSession();
        }
        return false;
    }

    // Admin login
    async login(email, password) {
        try {
            const response = await fetch(`${ADMIN_API}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success) {
                this.token = data.token;
                this.adminData = data.admin;
                localStorage.setItem('adminToken', this.token);
                localStorage.setItem('adminData', JSON.stringify(this.adminData));
                this.setSessionTimer();
                return { success: true, data: this.adminData };
            } else {
                return { success: false, error: data.message };
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Connection error' };
        }
    }

    // Validate current session
    async validateSession() {
        try {
            const response = await fetch(`${ADMIN_API}/validate`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            const data = await response.json();

            if (data.valid) {
                this.adminData = data.admin;
                this.setSessionTimer();
                return true;
            } else {
                this.logout();
                return false;
            }
        } catch (error) {
            this.logout();
            return false;
        }
    }

    // Set session timeout
    setSessionTimer() {
        if (this.timeoutId) clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(() => {
            this.logout();
            window.location.href = '/admin/login.html';
        }, this.sessionTimeout);
    }

    // Logout
    logout() {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminData');
        this.token = null;
        this.adminData = null;
        if (this.timeoutId) clearTimeout(this.timeoutId);
    }

    // Check role permission
    hasPermission(permission) {
        if (!this.adminData) return false;
        const rolePermissions = {
            super_admin: ['all'],
            admin: ['view_applications', 'manage_documents', 'view_reports'],
            moderator: ['view_applications', 'manage_documents'],
            viewer: ['view_applications']
        };
        const perms = rolePermissions[this.adminData.role] || [];
        return perms.includes('all') || perms.includes(permission);
    }

    // Get admin data
    getAdmin() {
        if (this.adminData) return this.adminData;
        const stored = localStorage.getItem('adminData');
        return stored ? JSON.parse(stored) : null;
    }
}

// Export singleton
const adminAuth = new AdminAuth();
