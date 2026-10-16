/**
 * Task battery for the agent benchmark. Four local fixture tasks (deterministic, from test/fixtures) and three
 * live toscrape.com tasks (sites built for scraping practice). Every task ends in a fact that only shows up if
 * the agent really did the steps, and `check` scores the final answer without a model.
 */
export interface Task {
  id: string;
  /** what the task exercises */
  about: string;
  prompt(base: string): string;
  check(answer: string): boolean;
}

/** The line after the last "ANSWER:", or the last non-empty line if the model forgot the prefix. */
const final = (a: string) => {
  const parts = a.split(/ANSWER:/i);
  const prefixed = parts.length > 1;
  const lines = (prefixed ? parts[parts.length - 1] : a).split('\n').map((l) => l.trim()).filter(Boolean);
  return (prefixed ? lines[0] : lines[lines.length - 1]) ?? '';
};
const has = (a: string, ...needles: (string | RegExp)[]) => needles.every((n) => (typeof n === 'string' ? a.toLowerCase().includes(n.toLowerCase()) : n.test(a)));

export const TASKS: Task[] = [
  {
    id: 'table',
    about: 'find two values in a 30-card catalog and a 120-row price list',
    prompt: (b) => `Open ${b}/table.html. Report (1) the price of the product card named "Widget 27" and (2) the price in the price list for the row named "Item 87".`,
    check: (a) => has(a, '40.50', '87.00'),
  },
  {
    id: 'article',
    about: 'count items on a long page, so nothing can be skimmed',
    prompt: (b) => `Open ${b}/article.html. How many paragraphs does the article contain in total? Each starts with "Paragraph N:". Answer with the number.`,
    check: (a) => (final(a).match(/\d+/g) ?? []).join() === '40',
  },
  {
    id: 'form',
    about: 'fill a form, continue, place the order, read the confirmation',
    prompt: (b) => `Open ${b}/shipping.html. Fill the form with email jane@example.com and full name Jane Doe, choose Canada as the country, tick "This is a gift" and choose Express shipping. Continue to review, click "Place order", then report the order total and the confirmation message shown.`,
    check: (a) => has(a, '12.00', 'Order placed'),
  },
  {
    id: 'spa',
    about: 'act on a list that re-renders after every click, then check the render counter',
    prompt: (b) => `Open ${b}/spa.html. Tick the checkboxes for "Task number 3", "Task number 7" and "Task number 12", then click "Load more". Report the text of the last task in the list and the "Renders:" counter value.`,
    check: (a) => has(a, 'Task number 45', /renders?[^.\d]{0,40}\b5\b/i),
  },
  {
    id: 'books-cheapest',
    about: 'live: navigate to a category and compare prices',
    prompt: () => 'Go to https://books.toscrape.com. Open the "Travel" category. Which book there is the cheapest and what is its price?',
    check: (a) => has(a, 'Little Dribbling', '23.21'),
  },
  {
    id: 'books-five-star',
    about: 'live: count across two pages of a category',
    prompt: () => 'Go to https://books.toscrape.com and open the "Mystery" category (it has two pages). How many of its books have a five-star rating? Answer with the number.',
    check: (a) => (final(a).match(/\d+/g) ?? []).join() === '5' || /^five\b/i.test(final(a)),
  },
  {
    id: 'quotes-login',
    about: 'live: log in, then read a value from page 2',
    prompt: () => 'Go to https://quotes.toscrape.com/login and log in with username admin and password admin. After logging in, open page 2 of the quotes. Who is the author of the third quote on that page?',
    check: (a) => has(a, 'Einstein'),
  },
];
