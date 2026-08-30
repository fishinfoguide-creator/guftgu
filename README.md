# Guftgu — Real Website Banane Ki Guide

Is folder mein aapki Guftgu chat app ka **poora, real website ban sakne wala code** hai.
Neeche diye steps follow karein — total waqt tqreeban 30-40 minute.

---

## Step 1 — Firebase Project Banayein (Free Database)

1. https://console.firebase.google.com par jayein, apne Gmail se sign in karein
2. "Add project" dabayein → naam likhein `guftgu` → baqi defaults rakhein → "Create project"
3. Left menu se **Build > Firestore Database** kholein → "Create database" → **"Start in test mode"** chunein → apne qareeb ka region select karein → "Enable"
4. Left menu ke upar gear icon (⚙️) > **Project settings** > neeche scroll karke "Your apps" mein **</> (Web)** icon dabayein
5. App ka naam likhein (jaise "guftgu-web") → "Register app"
6. Jo `firebaseConfig` object screen par dikhega, us ki saari values copy kar lein (apiKey, authDomain, projectId, waghera)

## Step 2 — Apni Keys Is Project Mein Daalein

1. Is folder mein `.env.example` file ko copy kar ke naam `.env.local` rakh dein
2. `.env.local` khol kar Step 1 se li gayi values yahan paste karein, jaise:
   ```
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=guftgu.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=guftgu
   VITE_FIREBASE_STORAGE_BUCKET=guftgu.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
   ```

## Step 3 — Firestore Security Rules Set Karein

1. Firebase Console mein **Firestore Database > Rules** tab kholein
2. Is folder ki `firestore.rules` file ka poora content copy karke wahan paste kar dein
3. "Publish" dabayein

## Step 4 — GitHub Par Upload Karein

1. https://github.com par account banayein (agar nahi hai)
2. Naya repository banayein, naam `guftgu` rakhein
3. Is poore folder (guftgu-web) ko us repository mein upload/push kar dein
   *(GitHub website se seedha "uploading an existing file" se bhi ho sakta hai — bas `.env.local` mat upload karna, wo already `.gitignore` mein excluded hai)*

## Step 5 — Vercel Par Deploy Karein (Free Hosting)

1. https://vercel.com par jayein → "Continue with GitHub" se sign in karein
2. "Add New… > Project" dabayein → apni `guftgu` GitHub repository chunein → "Import"
3. **Environment Variables** section mein wahi 6 values dobara daal dein (jo `.env.local` mein hain)
4. "Deploy" dabayein — 1-2 minute mein aapki website live ho jayegi (jaise `guftgu.vercel.app`)

## Step 6 — Apna Domain (guftgu.com / guftgu.pk) Jorein

1. Kisi bhi domain seller (Namecheap, GoDaddy, ya Pakistan mein PKNIC) se `guftgu.com` ya `guftgu.pk` khareedein
2. Vercel project ke **Settings > Domains** mein jayein → apna domain likh kar "Add" karein
3. Vercel jo 2 DNS records (A record ya CNAME) dikhaye, unhe apne domain seller ke DNS settings mein ja kar add kar dein
4. 10 minute se lekar kuch ghanton mein domain live ho jayega — koi bhi banda `guftgu.com` khol kar seedha account bana sakega

---

## Zaroori Baat — OTP Abhi Bhi "Demo Mode" Mein Hai

Is app mein OTP asal SMS se nahi jata — code seedha screen par dikha diya jata hai
(jaisa artifact mein tha). Real SMS bhejne ke liye ek paid SMS gateway (jaise Twilio)
aur ek chhota backend function chahiye hota hai — ye alag kaam hai. Agar chahein to
baad mein ye bhi add karwaya ja sakta hai.

## Security Note

`firestore.rules` mein filhaal koi login-check nahi (har koi database read/write kar
sakta hai) — taake app jaldi chal jaye. Real/public launch se pehle behtar hai ke
Firebase Authentication add karwa kar rules ko lock kiya jaye, taake koi bhi bahar se
seedha data na chhed sake.

---

## Local Par Test Karna (Optional, Deploy Se Pehle)

```
npm install
npm run dev
```
Phir browser mein `http://localhost:5173` kholein.
