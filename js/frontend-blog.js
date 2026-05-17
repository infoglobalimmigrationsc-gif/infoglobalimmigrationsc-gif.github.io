/**
 * FRONTEND BLOG DISPLAY
 * Automatically loads blog posts from backend API
 */

const BLOG_API = `${API_URL}/blogs`;

async function loadFrontendBlogs() {
    const blogContainer = document.getElementById('dynamic-blog-container');
    if (!blogContainer) return;

    try {
        // Show loading state
        blogContainer.innerHTML = `
            <div class="glass-shimmer" style="grid-column: 1/-1; padding: 60px; text-align: center;">
                <i class="fas fa-spinner fa-spin"></i> Loading latest posts...
            </div>
        `;

        const response = await fetch(`${BLOG_API}?status=published&limit=6`);
        const posts = await response.json();

        if (!posts.length) {
            blogContainer.innerHTML = `
                <div class="glass-card" style="grid-column: 1/-1; padding: 60px; text-align: center;">
                    <i class="fas fa-newspaper" style="font-size: 3rem; color: var(--primary-red); margin-bottom: 15px;"></i>
                    <h3>No Blog Posts Yet</h3>
                    <p>Check back soon for updates and immigration news!</p>
                </div>
            `;
            return;
        }

        blogContainer.innerHTML = posts.map(post => `
            <div class="glass-card blog-card" style="overflow: hidden;">
                ${post.featuredImage ? `
                    <div class="blog-image">
                        <img src="${post.featuredImage}" alt="${post.title}" loading="lazy" 
                             style="width: 100%; height: 220px; object-fit: cover;">
                    </div>
                ` : `
                    <div class="blog-image" style="background: linear-gradient(135deg, var(--primary-red), var(--primary-red-dark)); display: flex; align-items: center; justify-content: center;">
                        <i class="fas fa-newspaper" style="font-size: 3rem; color: white;"></i>
                    </div>
                `}
                <div class="blog-content" style="padding: 24px;">
                    <div class="blog-date" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <span><i class="far fa-calendar-alt"></i> ${new Date(post.createdAt).toLocaleDateString()}</span>
                        <span class="category-badge" style="background: rgba(227,6,19,0.1); color: var(--primary-red); padding: 4px 12px; border-radius: 20px; font-size: 0.75rem;">
                            ${post.category}
                        </span>
                    </div>
                    <h3 class="blog-title" style="font-size: 1.3rem; margin-bottom: 12px;">
                        <a href="/blog/${post.slug}" style="color: inherit; text-decoration: none;">${post.title}</a>
                    </h3>
                    <p class="blog-excerpt" style="color: var(--gray); margin-bottom: 20px; line-height: 1.5;">${post.excerpt}</p>
                    <a href="/blog/${post.slug}" class="glass-btn glass-btn-primary" style="display: inline-flex; align-items: center; gap: 8px;">
                        Read More <i class="fas fa-arrow-right"></i>
                    </a>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading blogs:', error);
        blogContainer.innerHTML = `
            <div class="glass-card" style="grid-column: 1/-1; padding: 60px; text-align: center;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--primary-red); margin-bottom: 15px;"></i>
                <h3>Unable to Load Posts</h3>
                <p>Please check back later or visit our Facebook page for updates.</p>
                <a href="https://www.facebook.com/share/16ZuMVLV3g/" class="glass-btn glass-btn-primary" style="margin-top: 20px;">
                    Visit Facebook Page
                </a>
            </div>
        `;
    }
}

// Load blogs when page loads
document.addEventListener('DOMContentLoaded', loadFrontendBlogs);
