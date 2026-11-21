/**
 * Health advice for the Home carousel. General lifestyle and medicine-handling tips only: never a
 * diagnosis, never a dose. Bundled so the carousel works offline. (C owns data/health-tips.json;
 * swap this file for that feed when it lands.)
 */
export interface Tip {
  id: string;
  topic: 'season' | 'storage' | 'antibiotic' | 'habit';
  text: string;
}

export const TIPS: Tip[] = [
  {
    id: 'season_winter',
    topic: 'season',
    text: 'শীতে কুসুম গরম পানি পান করুন এবং ঠান্ডা বাতাস থেকে বুক ও গলা ঢেকে রাখুন।',
  },
  {
    id: 'storage_cool',
    topic: 'storage',
    text: 'বেশিরভাগ ওষুধ ঠান্ডা, শুকনো জায়গায় রাখুন। সরাসরি রোদ ও গরম থেকে দূরে, সাধারণত ২৫° সেলসিয়াসের নিচে।',
  },
  {
    id: 'antibiotic_complete',
    topic: 'antibiotic',
    text: 'অ্যান্টিবায়োটিক ডাক্তারের দেওয়া সব দিন শেষ করুন। ভালো লাগলেও মাঝপথে বন্ধ করবেন না।',
  },
  {
    id: 'habit_expiry',
    topic: 'habit',
    text: 'ওষুধ খাওয়ার আগে মেয়াদের তারিখ দেখে নিন। মেয়াদোত্তীর্ণ ওষুধ ফেলে দিন।',
  },
  {
    id: 'habit_share',
    topic: 'habit',
    text: 'নিজের প্রেসক্রিপশনের ওষুধ অন্য কাউকে দেবেন না এবং অন্যের ওষুধ খাবেন না।',
  },
  {
    id: 'habit_water',
    topic: 'habit',
    text: 'ওষুধ খাওয়ার সময় সাধারণত এক গ্লাস পানি সাথে নিন, যদি না ডাক্তার অন্য কিছু বলে থাকেন।',
  },
  {
    id: 'season_rain',
    topic: 'season',
    text: 'বর্ষায় খাবার ও পানি ফুটিয়ে বা ঢেকে রাখুন। হাত ধোয়ার অভ্যাস রাখুন।',
  },
  {
    id: 'habit_list',
    topic: 'habit',
    text: 'ডাক্তারের কাছে যাওয়ার সময় চলমান সব ওষুধের তালিকা সাথে নিন।',
  },
];
