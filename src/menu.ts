// The menu lives in code. Prices are in pence. The server always recalculates
// prices from this file, so a changed price in the browser has no effect.

export interface OptionChoice { id: string; label: string; price: number }
export interface OptionGroup { id: string; legend: string; hint?: string; type: "one" | "many"; choices: OptionChoice[] }
export interface MenuItem {
  id: string; name: string; price: number; img: string; desc: string;
  tags: string[]; flag?: string; allergens: string; options: string[];
}
export interface MenuSection { id: string; name: string; when: string; cover: string; blurb: string; items: MenuItem[] }

export const OPTIONS: Record<string, OptionGroup> = {
  bread: { id: "bread", legend: "Choose your bread", type: "one", choices: [
    { id: "sourdough", label: "Sourdough", price: 0 }, { id: "rye", label: "Rye", price: 0 }, { id: "gf", label: "Gluten-free", price: 100 }] },
  extras: { id: "extras", legend: "Add extras", hint: "optional", type: "many", choices: [
    { id: "bacon", label: "Streaky bacon", price: 350 }, { id: "avocado", label: "Half an avocado", price: 300 }, { id: "egg", label: "Extra egg", price: 150 }] },
  milk: { id: "milk", legend: "Choose your milk", type: "one", choices: [
    { id: "whole", label: "Whole milk", price: 0 }, { id: "oat", label: "Oat milk", price: 40 }, { id: "soy", label: "Soy milk", price: 40 }] },
  coffee: { id: "coffee", legend: "Anything else?", hint: "optional", type: "many", choices: [
    { id: "shot", label: "Extra shot", price: 60 }, { id: "decaf", label: "Make it decaf", price: 0 }] },
  warm: { id: "warm", legend: "How would you like it?", type: "one", choices: [
    { id: "plain", label: "As it comes", price: 0 }, { id: "warm", label: "Warmed up", price: 0 }] },
  size: { id: "size", legend: "Choose a size", type: "one", choices: [
    { id: "regular", label: "Regular", price: 0 }, { id: "large", label: "Large", price: 120 }] },
};

export const MENU: MenuSection[] = [
  { id: "brunch", name: "Brunch", when: "Served until 2:30pm", cover: "/img/toast.jpg", blurb: "Eggs, good bread and a few plates that take a little longer.", items: [
    { id: "turkish-eggs", name: "Turkish eggs", price: 1200, img: "/img/shak3.jpg", desc: "Poached eggs, whipped garlic yoghurt, chilli butter and toasted rye.", tags: ["Vegetarian", "Spicy"], flag: "House favourite", allergens: "eggs, milk, gluten", options: ["bread", "extras"] },
    { id: "eggs-royale", name: "Eggs royale", price: 1350, img: "/img/table.jpg", desc: "Smoked salmon and hollandaise on a toasted English muffin.", tags: [], allergens: "eggs, fish, milk, gluten", options: ["extras"] },
    { id: "shakshuka", name: "Shakshuka", price: 1250, img: "/img/shak2.jpg", desc: "Eggs baked in peppers and tomato, with feta and warm flatbread.", tags: ["Vegetarian", "Spicy"], allergens: "eggs, milk, gluten", options: ["extras"] },
    { id: "avocado-toast", name: "Avocado toast", price: 1100, img: "/img/avotoast.jpg", desc: "Smashed avocado, cherry tomatoes, chives, lemon and chilli flakes.", tags: ["Vegan"], allergens: "gluten (unless you choose gluten-free bread)", options: ["bread", "extras"] },
    { id: "pancakes", name: "Buttermilk pancakes", price: 1150, img: "/img/pancake2.jpg", desc: "Raspberries, blueberries, maple syrup and crème fraîche.", tags: ["Vegetarian"], allergens: "eggs, milk, gluten", options: ["extras"] },
    { id: "hash-brown-stack", name: "Hash brown stack", price: 1300, img: "/img/hashbrown.jpg", desc: "Crispy hash browns with a fried egg, streaky bacon and pickled chilli.", tags: ["Spicy"], allergens: "eggs", options: ["extras"] },
    { id: "fieldfare-plate", name: "The Fieldfare plate", price: 1500, img: "/img/fullplate2.jpg", desc: "Two eggs, bacon, sausage, beans, mushrooms, black pudding and toast.", tags: [], allergens: "eggs, gluten, sulphites", options: ["bread"] },
    { id: "granola", name: "Granola bowl", price: 850, img: "/img/granola.jpg", desc: "Our own granola with Greek yoghurt, blackberries and honey.", tags: ["Vegetarian"], allergens: "milk, nuts, oats", options: [] },
  ] },
  { id: "sides", name: "Sides", when: "Add to any dish", cover: "/img/halloumi.jpg", blurb: "Make it a bigger morning. Order them with a dish or on their own.", items: [
    { id: "bacon", name: "Streaky bacon", price: 350, img: "/img/bacon.jpg", desc: "Two rashers of dry-cured bacon, cooked crisp.", tags: [], allergens: "none of the 14 main allergens", options: [] },
    { id: "halloumi", name: "Grilled halloumi", price: 400, img: "/img/halloumi2.jpg", desc: "Three slices with lemon and oregano.", tags: ["Vegetarian", "Gluten-free"], allergens: "milk", options: [] },
    { id: "sourdough", name: "Sourdough and butter", price: 300, img: "/img/sourdough.jpg", desc: "Two thick slices from the bakery down the road.", tags: ["Vegetarian"], allergens: "gluten, milk", options: [] },
    { id: "beans", name: "Beans and mushrooms", price: 350, img: "/img/fullplate.jpg", desc: "Slow-cooked beans, garlic mushrooms and roast tomato.", tags: ["Vegan", "Gluten-free"], allergens: "none of the 14 main allergens", options: [] },
  ] },
  { id: "bakes", name: "Bakes", when: "Fresh from 8am", cover: "/img/croissant.jpg", blurb: "Baked here every morning in small batches. When they are gone, they are gone.", items: [
    { id: "cardamom-bun", name: "Cardamom bun", price: 380, img: "/img/buns.jpg", desc: "A soft knotted bun rolled in cardamom sugar.", tags: ["Vegetarian"], allergens: "gluten, milk, eggs", options: ["warm"] },
    { id: "cinnamon-bun", name: "Cinnamon bun", price: 380, img: "/img/buns2.jpg", desc: "Brown butter and cinnamon, with cream cheese icing.", tags: ["Vegetarian"], allergens: "gluten, milk, eggs", options: ["warm"] },
    { id: "croissant", name: "Butter croissant", price: 320, img: "/img/croissant2.jpg", desc: "Made with French butter over two days.", tags: ["Vegetarian"], allergens: "gluten, milk, eggs", options: ["warm"] },
    { id: "banana-bread", name: "Banana bread", price: 360, img: "/img/bananabread.jpg", desc: "A thick slice with walnuts and salted butter.", tags: ["Vegetarian"], allergens: "gluten, milk, eggs, nuts", options: ["warm"] },
  ] },
  { id: "coffee", name: "Coffee", when: "Roasted in London", cover: "/img/espresso.jpg", blurb: "Every coffee comes with a double shot. Oat and soy milk are 40p extra.", items: [
    { id: "flat-white", name: "Flat white", price: 360, img: "/img/pour.jpg", desc: "A double shot with smooth, silky milk.", tags: [], allergens: "milk (unless you choose oat or soy)", options: ["milk", "coffee"] },
    { id: "latte", name: "Latte", price: 380, img: "/img/latte.jpg", desc: "A double shot with more milk and a little foam.", tags: [], allergens: "milk (unless you choose oat or soy)", options: ["milk", "coffee"] },
    { id: "iced-latte", name: "Iced latte", price: 400, img: "/img/iced2.jpg", desc: "A double shot poured over ice and cold milk.", tags: [], allergens: "milk (unless you choose oat or soy)", options: ["milk", "coffee"] },
    { id: "cold-brew", name: "Cold brew", price: 380, img: "/img/iced.jpg", desc: "Steeped for 18 hours and served over ice.", tags: ["Vegan"], allergens: "none of the 14 main allergens", options: ["milk"] },
  ] },
  { id: "drinks", name: "Other drinks", when: "Juice, tea and more", cover: "/img/terrace.jpg", blurb: "Fresh orange juice, matcha, smoothies and a proper chai.", items: [
    { id: "orange-juice", name: "Fresh orange juice", price: 400, img: "/img/oj.jpg", desc: "Squeezed fresh every morning.", tags: ["Vegan", "Gluten-free"], allergens: "none of the 14 main allergens", options: ["size"] },
    { id: "matcha", name: "Matcha latte", price: 420, img: "/img/matcha.jpg", desc: "Stone-ground matcha, served hot or iced.", tags: ["Vegetarian"], allergens: "milk (unless you choose oat or soy)", options: ["milk"] },
    { id: "smoothie", name: "Berry smoothie", price: 550, img: "/img/smoothie.jpg", desc: "Blackberry, banana and oat milk, topped with mint.", tags: ["Vegan"], allergens: "oats", options: ["size"] },
    { id: "chai", name: "Masala chai", price: 380, img: "/img/chai.jpg", desc: "Whole spices simmered with the milk of your choice.", tags: ["Vegetarian"], allergens: "milk (unless you choose oat or soy)", options: ["milk"] },
  ] },
];

const ITEM_INDEX = new Map<string, MenuItem>();
for (const s of MENU) for (const it of s.items) ITEM_INDEX.set(it.id, it);
export const findItem = (id: string) => ITEM_INDEX.get(id);

export interface CartLine { id: string; qty: number; options: Record<string, string[]> }
export interface PricedLine { id: string; name: string; qty: number; options: string[]; unit: number; total: number }

/** Validates one cart line against the menu and returns its price, or an error message. */
export function priceLine(line: CartLine): PricedLine | string {
  const item = findItem(String(line?.id));
  if (!item) return "One of the dishes is no longer on the menu.";
  const qty = Math.floor(Number(line.qty));
  if (!(qty >= 1 && qty <= 10)) return `Please choose between 1 and 10 of ${item.name}.`;
  let unit = item.price;
  const labels: string[] = [];
  const chosen = line.options && typeof line.options === "object" ? line.options : {};
  for (const gid of item.options) {
    const g = OPTIONS[gid];
    const picked = Array.isArray(chosen[gid]) ? chosen[gid].map(String) : [];
    if (g.type === "one") {
      const c = g.choices.find((x) => x.id === picked[0]) ?? g.choices[0];
      unit += c.price;
      if (c !== g.choices[0]) labels.push(c.label);
    } else {
      for (const c of g.choices) if (picked.includes(c.id)) { unit += c.price; labels.push(c.label); }
    }
  }
  return { id: item.id, name: item.name, qty, options: labels, unit, total: unit * qty };
}
