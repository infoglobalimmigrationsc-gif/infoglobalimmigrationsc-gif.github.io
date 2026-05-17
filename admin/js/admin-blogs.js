/**
 * BLOG MANAGEMENT SYSTEM
 * Create, edit, delete blog posts from admin dashboard
 */

class BlogManager {
    constructor() {
        this.apiUrl = `${API_URL}/blogs`;
        this.posts = [];
        this.categories = [];
    }

    // Initialize blog manager
    async init() {
        await this.loadCategories();
        await this.loadPosts();
        this.setupEventListeners();
        this.setupRichTextEditor();
    }

    // Setup rich text editor (TinyMCE)
    setupRichTextEditor() {
        tinymce.init({
            selector: '#blogContent',
            height: 400,
            menubar: true,
            plugins: [
                'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
                'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
                'insertdatetime', 'media', 'table', 'help', 'wordcount'
            ],
            toolbar: 'undo redo | blocks | bold italic backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | removeformat | help',
            images_upload_url: `${API_URL}/upload/image`,
            automatic_uploads: true,
            file_picker_types: 'image',
            relative_urls: false,
            remove_script_host: false,
            document_base_url: window.location.origin
        });
    }

    // Load blog posts
    async loadPosts() {
        try {
            const response = await fetch(`${this.apiUrl}?status=all`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            this.posts = await response.json();
            this.renderPostsList();
            this.updateStats();
        } catch (error) {
            console.error('Error loading posts:', error);
        }
    }

    // Load categories
    async loadCategories() {
        try {
            const response = await fetch(`${this.apiUrl}/categories`);
            this.categories = await response.json();
            this.renderCategorySelect();
        } catch (error) {
            console.error('Error loading categories:', error);
            // Default categories
            this.categories = [
                { id: 'study-abroad', name: 'Study Abroad' },
                { id: 'visa-tips', name: 'Visa Tips' },
                { id: 'scholarships', name: 'Scholarships' },
                { id: 'immigration-news', name: 'Immigration News' },
                { id: 'student-stories', name: 'Student Stories' },
                { id: 'travel-guides', name: 'Travel Guides' }
            ];
        }
    }

    // Create new post
    async createPost(postData) {
        try {
            // Generate SEO-friendly slug
            const slug = this.generateSlug(postData.title);
            
            const formData = new FormData();
            formData.append('title', postData.title);
            formData.append('slug', slug);
            formData.append('excerpt', postData.excerpt);
            formData.append('content', tinymce.get('blogContent').getContent());
            formData.append('category', postData.category);
            formData.append('author', adminAuth.getAdmin().name);
            formData.append('status', postData.status || 'draft');
            
            if (postData.featuredImage) {
                formData.append('featuredImage', postData.featuredImage);
            }

            const response = await fetch(`${this.apiUrl}/create`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                },
                body: formData
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('Blog post created successfully!', 'success');
                await this.loadPosts();
                this.resetForm();
                return true;
            } else {
                this.showToast(result.error || 'Failed to create post', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error creating post:', error);
            this.showToast('Error creating post', 'error');
            return false;
        }
    }

    // Update post
    async updatePost(postId, postData) {
        try {
            const formData = new FormData();
            formData.append('title', postData.title);
            formData.append('excerpt', postData.excerpt);
            formData.append('content', tinymce.get('blogContent').getContent());
            formData.append('category', postData.category);
            formData.append('status', postData.status);
            
            if (postData.featuredImage) {
                formData.append('featuredImage', postData.featuredImage);
            }

            const response = await fetch(`${this.apiUrl}/${postId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                },
                body: formData
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('Blog post updated successfully!', 'success');
                await this.loadPosts();
                this.resetForm();
                return true;
            } else {
                this.showToast(result.error || 'Failed to update post', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error updating post:', error);
            this.showToast('Error updating post', 'error');
            return false;
        }
    }

    // Delete post
    async deletePost(postId) {
        if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
            return false;
        }

        try {
            const response = await fetch(`${this.apiUrl}/${postId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('Blog post deleted successfully!', 'success');
                await this.loadPosts();
                return true;
            } else {
                this.showToast(result.error || 'Failed to delete post', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error deleting post:', error);
            this.showToast('Error deleting post', 'error');
            return false;
        }
    }

    // Publish post (frontend)
    async publishToFrontend(postId) {
        try {
            const response = await fetch(`${this.apiUrl}/${postId}/publish`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('Post published to frontend!', 'success');
                await this.loadPosts();
                return true;
            } else {
                this.showToast(result.error || 'Failed to publish', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error publishing post:', error);
            this.showToast('Error publishing post', 'error');
            return false;
        }
    }

    // Generate SEO slug
    generateSlug(title) {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // Handle image upload
    async uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);

        try {
            const response = await fetch(`${API_URL}/upload/image`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                },
                body: formData
            });

            const result = await response.json();
            return result.url;
        } catch (error) {
            console.error('Error uploading image:', error);
            return null;
        }
    }

    // Render posts list in admin dashboard
    renderPostsList() {
        const container = document.getElementById('blogPostsList');
        if (!container) return;

        container.innerHTML = this.posts.map(post => `
            <div class="glass-card blog-item" data-post-id="${post.id}" style="margin-bottom: 20px; padding: 20px;">
                <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                    ${post.featuredImage ? `
                        <img src="${post.featuredImage}" alt="${post.title}" style="width: 100px; height: 80px; object-fit: cover; border-radius: 8px;">
                    ` : `
                        <div style="width: 100px; height: 80px; background: rgba(0,0,0,0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-image"></i>
                        </div>
                    `}
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 5px 0;">${this.escapeHtml(post.title)}</h4>
                        <div style="display: flex; gap: 15px; font-size: 0.85rem; color: #666; margin-bottom: 10px;">
                            <span><i class="far fa-calendar"></i> ${new Date(post.createdAt).toLocaleDateString()}</span>
                            <span><i class="far fa-folder"></i> ${post.category}</span>
                            <span class="status-badge status-${post.status}">${post.status}</span>
                        </div>
                        <p style="margin: 0; color: #777; font-size: 0.9rem;">${this.truncate(post.excerpt, 100)}</p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="blogManager.editPost('${post.id}')" class="glass-btn glass-btn-small" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="blogManager.publishToFrontend('${post.id}')" class="glass-btn glass-btn-small glass-btn-success" title="Publish to Frontend">
                            <i class="fas fa-globe"></i>
                        </button>
                        <button onclick="blogManager.deletePost('${post.id}')" class="glass-btn glass-btn-small glass-btn-danger" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('') || '<p class="glass-card" style="padding: 40px; text-align: center;">No blog posts yet. Create your first post!</p>';
    }

    // Update stats
    updateStats() {
        const stats = {
            total: this.posts.length,
            published: this.posts.filter(p => p.status === 'published').length,
            drafts: this.posts.filter(p => p.status === 'draft').length,
            scheduled: this.posts.filter(p => p.status === 'scheduled').length
        };

        document.getElementById('totalPostsCount').textContent = stats.total;
        document.getElementById('publishedPostsCount').textContent = stats.published;
        document.getElementById('draftPostsCount').textContent = stats.drafts;
    }

    // Show toast notification
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }, 100);
    }

    // Helper functions
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    truncate(text, length) {
        if (text.length <= length) return text;
        return text.substring(0, length) + '...';
    }
}

// Initialize blog manager when page loads
const blogManager = new BlogManager();
document.addEventListener('DOMContentLoaded', () => blogManager.init());
