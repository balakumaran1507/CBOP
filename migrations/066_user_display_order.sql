ALTER TABLE users ADD COLUMN IF NOT EXISTS display_order INT;

UPDATE users SET display_order = 1 WHERE email = 'founders@cybercomctf.com';
UPDATE users SET display_order = 2 WHERE email = 'nabeelahanjum.wrk@gmail.com';
UPDATE users SET display_order = 3 WHERE email = 'guru2006may@gmail.com';
UPDATE users SET display_order = 4 WHERE email = 'jaiebalajijaie27@gmail.com';
UPDATE users SET display_order = 5 WHERE email = 'raghunandhanthillai0@gmail.com';
UPDATE users SET display_order = 6 WHERE email = 'founders@ouantum.com';
UPDATE users SET display_order = 7 WHERE email = 'founders@zapsters.in';
