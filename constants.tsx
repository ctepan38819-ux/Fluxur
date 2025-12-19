
import React from 'react';

export const COLORS = {
  primary: '#8b5cf6', // Violet 500
  secondary: '#3b82f6', // Blue 500
  accent: '#10b981', // Emerald 500
  bg: '#0f172a', // Slate 900
  card: '#1e293b', // Slate 800
  text: '#f8fafc', // Slate 50
};

export const ICONS = {
  Logo: (props: any) => (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <defs>
        <linearGradient id="fluxur-gradient-main" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#c026d3" />
        </linearGradient>
        <linearGradient id="fluxur-gradient-circuit" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#c026d3" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      
      {/* Black Background as requested (do not change or remove) */}
      <rect width="100" height="100" fill="#000000" />
      
      {/* The Arrow Stem of the 'F' - High fidelity recreation */}
      <path 
        d="M28 82 L28 40 L18 40 L34 15 L50 40 L40 40 L40 82 Z" 
        fill="url(#fluxur-gradient-main)"
      />
      
      {/* The Wing Top Bar of the 'F' */}
      <path 
        d="M45 22 H78 C90 22 95 32 85 42 H52 L45 22 Z" 
        fill="url(#fluxur-gradient-main)"
      />
      
      {/* Integrated Speech Bubble with 3 dots */}
      <path 
        d="M52 48 C52 44 75 44 75 54 C75 62 60 62 60 68 L56 72 V62 C48 62 48 48 52 48 Z" 
        fill="#1e293b" 
        stroke="#3b82f6" 
        strokeWidth="1"
      />
      <circle cx="60" cy="54" r="1.2" fill="white" />
      <circle cx="65" cy="54" r="1.2" fill="white" />
      <circle cx="70" cy="54" r="1.2" fill="white" />
      
      {/* Left Circuit Node Decoration with Glow */}
      <g filter="url(#glow)">
        <circle cx="28" cy="58" r="4.5" stroke="#c026d3" strokeWidth="2.5" fill="#000000" />
        <path 
          d="M28 62.5 V74 H42" 
          stroke="url(#fluxur-gradient-circuit)" 
          strokeWidth="3.5" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
        />
        <circle cx="46" cy="74" r="3.5" fill="#8b5cf6" />
      </g>
    </svg>
  ),
  Message: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  ),
  Sparkles: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
  ),
  Settings: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12.22 2h-.44a2 2 0 0 0-2 2l-.28 2.23a7 7 0 0 1-2.32 1.28l-2.13-.73a2 2 0 0 0-2.41 1.1l-.22.44a2 2 0 0 0 .73 2.41l1.84 1.27a7 7 0 0 1 0 2.62l-1.84 1.27a2 2 0 0 0-.73 2.41l.22.44a2 2 0 0 0 2.41 1.1l2.13-.73a7 7 0 0 1 2.32 1.28l.28 2.23a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2l.28-2.23a7 7 0 0 1 2.32-1.28l2.13.73a2 2 0 0 0 2.41-1.1l.22-.44a2 2 0 0 0-.73-2.41l-1.84-1.27a7 7 0 0 1 0-2.62l-1.84-1.27a2 2 0 0 0 .73-2.41l-.22-.44a2 2 0 0 0-2.41-1.1l-2.13.73a7 7 0 0 1-2.32-1.28L14.22 4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  User: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  ),
  Send: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
  ),
  Plus: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
  MoreHorizontal: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
  ),
  Search: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  ),
  Back: (props: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m15 18-6-6 6-6"/></svg>
  ),
};
