/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mc: {
          bg:     '#07090f',
          bg2:    '#0d1120',
          gold:   '#f4a836',
          blue:   '#3b9eff',
          teal:   '#00d4c8',
          green:  '#22d06b',
          amber:  '#ffba08',
          text:   '#c8d3e8',
          dim:    '#5a6a88',
        },
      },
    },
  },
  plugins: [],
}
