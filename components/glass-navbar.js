/**
 * GLASS NAVBAR WITH RESPONSIVE MOBILE MENU
 */

class GlassNavbar {
    constructor() {
        this.menuToggle = document.querySelector('.mobile-toggle');
        this.navMenu = document.querySelector('.nav-menu');
        this.header = document.querySelector('header');
        this.isOpen = false;
        this.init();
    }

    init() {
        if (!this.menuToggle) return;
        
        this.menuToggle.addEventListener('click', () => this.toggleMenu());
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.navMenu.contains(e.target) && !this.menuToggle.contains(e.target)) {
                this.closeMenu();
            }
        });
        
        // Close menu on window resize (if becoming desktop)
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && this.isOpen) {
                this.closeMenu();
            }
        });
        
        // Add scroll effect
        window.addEventListener('scroll', () => this.handleScroll());
        
        // Handle dropdowns on mobile
        if (window.innerWidth <= 768) {
            this.setupMobileDropdowns();
        }
        
        // Handle window resize for dropdowns
        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768) {
                this.setupMobileDropdowns();
            } else {
                this.removeMobileDropdowns();
            }
        });
    }

    toggleMenu() {
        if (this.isOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    openMenu() {
        this.navMenu.classList.add('active');
        this.menuToggle.querySelector('i').classList.remove('fa-bars');
        this.menuToggle.querySelector('i').classList.add('fa-times');
        this.isOpen = true;
        document.body.style.overflow = 'hidden';
    }

    closeMenu() {
        this.navMenu.classList.remove('active');
        this.menuToggle.querySelector('i').classList.remove('fa-times');
        this.menuToggle.querySelector('i').classList.add('fa-bars');
        this.isOpen = false;
        document.body.style.overflow = '';
    }

    handleScroll() {
        if (window.scrollY > 50) {
            this.header.classList.add('scrolled');
        } else {
            this.header.classList.remove('scrolled');
        }
    }

    setupMobileDropdowns() {
        const dropdowns = document.querySelectorAll('.dropdown');
        
        dropdowns.forEach(dropdown => {
            const link = dropdown.querySelector(' > a');
            if (!link) return;
            
            link.removeEventListener('click', this.dropdownClickHandler);
            this.dropdownClickHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Close other dropdowns
                dropdowns.forEach(d => {
                    if (d !== dropdown) d.classList.remove('active');
                });
                
                dropdown.classList.toggle('active');
            };
            
            link.addEventListener('click', this.dropdownClickHandler);
        });
    }

    removeMobileDropdowns() {
        const dropdowns = document.querySelectorAll('.dropdown');
        dropdowns.forEach(dropdown => {
            dropdown.classList.remove('active');
            const link = dropdown.querySelector(' > a');
            if (link && this.dropdownClickHandler) {
                link.removeEventListener('click', this.dropdownClickHandler);
            }
        });
    }
}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => new GlassNavbar());
