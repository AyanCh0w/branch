// Signup rules match backend/service.ts. Sign-in must also accept migrated usernames.
function validateSignup(username,password){
 const normalized=String(username).trim().normalize('NFKC').toLowerCase(),errors={};
 if(!/^[a-z0-9_-]{3,64}$/.test(normalized))errors.username=normalized.includes('@')?'Choose a username, not an email address. Use 3–64 letters, numbers, underscores or dashes.':'Your username needs 3–64 letters, numbers, underscores or dashes.';
 if(password.length<12)errors.password='Your password needs at least 12 characters.';
 else if(password.length>512)errors.password='Your password must be 512 characters or fewer.';
 return errors;
}
function fieldForAuthError(message){
 if(/username is taken|3–64|Use a username/.test(message))return 'username';
 if(/at least \d+ characters for your password|Check your password/.test(message))return 'password';
 return null;
}
module.exports={validateSignup,fieldForAuthError};
