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
        // Marca (NÃO flipa no dark): verde, accent, danger, success — hex fixo.
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
        success: {
          DEFAULT: '#4CAF50', // Vibrant Green
          light: '#6DC470',
        },
        danger: {
          DEFAULT: '#DC3545',
          light: '#E55563',
        },
        // Neutros semânticos (FLIPAM no dark via CSS vars em index.css).
        neutral: {
          dark: 'rgb(var(--text) / <alpha-value>)',          // texto principal
          mid: 'rgb(var(--text-secondary) / <alpha-value>)', // sub-texto
          light: 'rgb(var(--border) / <alpha-value>)',       // borda/divisor
          lighter: 'rgb(var(--surface-2) / <alpha-value>)',  // superfície sutil
        },
        background: 'rgb(var(--bg) / <alpha-value>)',      // fundo da página
        surface: 'rgb(var(--surface) / <alpha-value>)',    // cards/superfície
        // Verde da marca COMO TEXTO/ícone — clareia no dark p/ manter legível
        // (diferente de bg-primary, que mantém o verde escuro de preenchimento).
        brand: 'rgb(var(--brand) / <alpha-value>)',
      },
      textColor: {
        primary: 'rgb(var(--text) / <alpha-value>)',
        secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
        tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
      },
      borderColor: {
        DEFAULT: 'rgb(var(--border) / <alpha-value>)',
        light: 'rgb(var(--border-subtle) / <alpha-value>)',
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
