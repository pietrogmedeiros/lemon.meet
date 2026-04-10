/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Lemon.meet Design System
        primary: {
          DEFAULT: '#2D5A27', // Lemon Green - Títulos, botões, identidade
          light: '#4CAF50',   // Vibrant Green - Hover, links ativos, sucesso
          dim: '#1E3D1A',     // Lemon Green escuro
        },
        accent: {
          DEFAULT: '#FFD700', // Lemon Yellow - ícone, badges, destaques
          light: '#FFE55C',
          dark: '#E6C200',
        },
        neutral: {
          dark: '#333333',    // Text body
          mid: '#666666',     // Sub-texto
          light: '#E0E0E0',   // Border/Divider
          lighter: '#F5F5F5', // Background sutil
        },
        success: {
          DEFAULT: '#4CAF50', // Vibrant Green
          light: '#6DC470',
        },
        danger: {
          DEFAULT: '#DC3545',
          light: '#E55563',
        },
        background: '#F8F9FA', // Cinza quase branco
        surface: '#FFFFFF',    // Branco puro para cards
      },
      textColor: {
        primary: '#333333',
        secondary: '#666666',
        tertiary: '#999999',
      },
      borderColor: {
        DEFAULT: '#E0E0E0',
        light: '#F0F0F0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Poppins', 'Montserrat', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'headline-1': ['24px', { lineHeight: '32px', fontWeight: '700' }],
        'headline-2': ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'body-large': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-small': ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'button': ['16px', { lineHeight: '24px', fontWeight: '500' }],
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
    },
  },
  plugins: [],
}
