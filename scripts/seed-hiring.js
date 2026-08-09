// Seed hiring roles and default settings for all 5 companies
const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const ROLES = [
  // CYBERCOM CTF
  { company_name: 'CYBERCOM CTF', title: 'CTF Challenge Author', role_type: 'ctf_author', is_technical: true, required_skills: ['CTF', 'exploit development', 'cryptography'], preferred_skills: ['pwn', 'reverse engineering', 'web exploitation'] },
  { company_name: 'CYBERCOM CTF', title: 'Security Researcher', role_type: 'security_research', is_technical: true, required_skills: ['vulnerability research', 'networking', 'Linux'], preferred_skills: ['CVE analysis', 'fuzzing', 'threat intelligence'] },
  { company_name: 'CYBERCOM CTF', title: 'Red Team / Blue Team', role_type: 'red_blue_team', is_technical: true, required_skills: ['penetration testing', 'SIEM', 'incident response'], preferred_skills: ['Metasploit', 'Burp Suite', 'MITRE ATT&CK'] },
  // Etherence IT
  { company_name: 'Etherence IT', title: 'Full Stack Developer', role_type: 'full_stack', is_technical: true, required_skills: ['React', 'Node.js', 'PostgreSQL'], preferred_skills: ['TypeScript', 'Docker', 'AWS'] },
  { company_name: 'Etherence IT', title: 'Front End Developer', role_type: 'front_end', is_technical: true, required_skills: ['React', 'TypeScript', 'CSS'], preferred_skills: ['Next.js', 'Tailwind', 'testing'] },
  { company_name: 'Etherence IT', title: 'Back End Developer', role_type: 'back_end', is_technical: true, required_skills: ['Node.js', 'PostgreSQL', 'REST APIs'], preferred_skills: ['TypeScript', 'Redis', 'Docker'] },
  { company_name: 'Etherence IT', title: 'Cloud Developer', role_type: 'cloud', is_technical: true, required_skills: ['AWS', 'cloud architecture', 'DevOps'], preferred_skills: ['Terraform', 'Kubernetes', 'CI/CD'] },
  { company_name: 'Etherence IT', title: 'DevOps Engineer', role_type: 'devops', is_technical: true, required_skills: ['Docker', 'Linux', 'CI/CD'], preferred_skills: ['Kubernetes', 'Terraform', 'monitoring'] },
  // Etherence Pentest
  { company_name: 'Etherence Pentest', title: 'Red Team / Blue Team', role_type: 'red_blue_team', is_technical: true, required_skills: ['penetration testing', 'OSCP', 'web security'], preferred_skills: ['Burp Suite', 'Metasploit', 'OSINT'] },
  { company_name: 'Etherence Pentest', title: 'Auditing / Compliance', role_type: 'auditing', is_technical: true, required_skills: ['ISO 27001', 'VAPT', 'risk assessment'], preferred_skills: ['GDPR', 'SOC 2', 'NIST'] },
  // AttackOS
  { company_name: 'AttackOS', title: 'Game Developer', role_type: 'game_dev', is_technical: true, required_skills: ['Unity', 'C#', 'game design'], preferred_skills: ['Unreal Engine', 'shader programming', '2D/3D art'] },
  { company_name: 'AttackOS', title: '3D Modeling / Art', role_type: '3d_art', is_technical: true, required_skills: ['Blender', '3D modeling', 'texturing'], preferred_skills: ['Substance Painter', 'rigging', 'animation'] },
  // ouantum
  { company_name: 'ouantum', title: 'Machine Learning Engineer', role_type: 'ml_engineering', is_technical: true, required_skills: ['Python', 'PyTorch', 'machine learning'], preferred_skills: ['LLMs', 'MLOps', 'CUDA', 'transformers'] },
  { company_name: 'ouantum', title: 'AI Research', role_type: 'ai_research', is_technical: true, required_skills: ['Python', 'research papers', 'deep learning'], preferred_skills: ['reinforcement learning', 'NLP', 'computer vision'] },
]

// Marketing role for all companies
const MARKETING_COMPANIES = ['CYBERCOM CTF', 'Etherence IT', 'Etherence Pentest', 'AttackOS', 'ouantum']

const DEFAULT_REJECTION_TEMPLATE = `Hi {{applicant_name}},

Thank you for applying for the {{role_title}} position at {{company_name}}.

After reviewing your application, we will not be moving forward at this time.

We encourage you to continue building your skills and apply again in the future.

Best,
{{company_name}} Team`

const DEFAULT_INTERVIEW_TEMPLATE = `Hi {{applicant_name}},

We reviewed your application for {{role_title}} and would like to invite you for an interview.

Date: {{interview_date}}
Time: {{interview_time}} IST
Meeting Link: {{meet_link}}

Please confirm your attendance by replying to this email.

Best,
{{interviewer_name}}
{{company_name}}`

const DEFAULT_OFFER_TEMPLATE = `Hi {{applicant_name}},

We are pleased to offer you an internship position as {{role_title}} at {{company_name}}.

Please find the offer letter attached. Review the terms and reply:
- "I ACCEPT" to confirm your joining
- "I DECLINE" if you wish to withdraw

The offer expires in 48 hours.

Welcome aboard,
{{company_name}} Team`

const DEFAULT_WELCOME_TEMPLATE = `Hi {{applicant_name}},

Welcome to the team! We are excited to have you join us as {{role_title}}.

Your start date: {{start_date}}
Your team lead: {{team_lead_name}}
Reporting to: {{team_lead_email}}

You will receive separate invites for:
- Slack workspace
- Discord server
- Wiki / documentation access

See you soon,
{{company_name}} Team`

async function seed() {
  const client = await pool.connect()
  try {
    // Fetch all companies
    const companiesRes = await client.query('SELECT id, name FROM companies')
    const companyMap = {}
    for (const row of companiesRes.rows) companyMap[row.name] = row.id

    console.log('Companies found:', Object.keys(companyMap))

    // Seed hiring roles
    for (const role of ROLES) {
      const companyId = companyMap[role.company_name]
      if (!companyId) { console.warn(`Company not found: ${role.company_name}`); continue }

      await client.query(
        `INSERT INTO hiring_roles (company_id, title, role_type, is_technical, required_skills, preferred_skills, employment_type, active)
         VALUES ($1,$2,$3,$4,$5,$6,'intern_unpaid',true)
         ON CONFLICT DO NOTHING`,
        [companyId, role.title, role.role_type, role.is_technical, role.required_skills, role.preferred_skills]
      )
      console.log(`  + Role: ${role.title} @ ${role.company_name}`)
    }

    // Marketing roles for all companies
    for (const companyName of MARKETING_COMPANIES) {
      const companyId = companyMap[companyName]
      if (!companyId) continue
      await client.query(
        `INSERT INTO hiring_roles (company_id, title, role_type, is_technical, required_skills, preferred_skills, employment_type, active)
         VALUES ($1,'Marketing','marketing',false,$2,$3,'intern_unpaid',true)
         ON CONFLICT DO NOTHING`,
        [companyId, ['social media', 'content writing', 'marketing strategy'], ['Canva', 'SEO', 'analytics']]
      )
      console.log(`  + Role: Marketing @ ${companyName}`)
    }

    // Seed hiring_settings for all companies
    for (const [companyName, companyId] of Object.entries(companyMap)) {
      await client.query(
        `INSERT INTO hiring_settings (company_id, rejection_delay_hours, auto_reject_threshold, auto_shortlist_threshold,
           rejection_email_template, interview_email_template, offer_email_template, welcome_email_template)
         VALUES ($1, 48, 25, 75, $2, $3, $4, $5)
         ON CONFLICT (company_id) DO NOTHING`,
        [companyId, DEFAULT_REJECTION_TEMPLATE, DEFAULT_INTERVIEW_TEMPLATE, DEFAULT_OFFER_TEMPLATE, DEFAULT_WELCOME_TEMPLATE]
      )
      console.log(`  + Settings: ${companyName}`)
    }

    console.log('\nHiring seed complete.')
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch((err) => { console.error(err); process.exit(1) })
