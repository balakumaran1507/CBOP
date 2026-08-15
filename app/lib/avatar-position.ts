import React from 'react'

export function getAvatarStyle(email?: string | null): React.CSSProperties {
  if (!email) return { objectPosition: 'center center' }
  const normEmail = email.toLowerCase()
  
  if (normEmail.includes('rahul')) {
    // Shifts image down to show more headroom / lower the face framing
    return { objectPosition: 'center 18%' }
  }
  if (normEmail.includes('nabeelah')) {
    // Shifts image down to center Nabeelah's portrait
    return { objectPosition: 'center 24%' }
  }
  if (normEmail.includes('guru')) {
    // Shifts image down to center Guru's portrait
    return { objectPosition: 'center 18%' }
  }
  
  return { objectPosition: 'center center' }
}
