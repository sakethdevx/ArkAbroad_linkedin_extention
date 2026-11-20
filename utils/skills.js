'use strict';

// skills.js — the one skill vocabulary, shared by the resume reader (utils/resume.js) and the job-fit check (utils/jobfit.js).
// Pure: no DOM, no network.
//   Skills.SKILL_VOCAB            canonical skill names
//   Skills.canonical(name)        "js" → "JavaScript"; unknown names come back unchanged
//   Skills.find(text)             → [{ skill, literal }]  every vocabulary skill the text names, with the wording the text used ("JS")
//   Skills.has(text, skill)       does the text name this skill (by any of its spellings)?
// find() is deliberately stricter than the resume reader for one-letter names: "C" and "R" only count when the text clearly means
// the languages ("C/C++", "R programming"), so "Option C" or "plan R" in a job post is not a skill.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Skills = api;
})(typeof self !== 'undefined' ? self : this, function () {

  const SKILL_VOCAB = [
    'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'C', 'Go', 'Rust', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'R', 'MATLAB', 'Scala',
    'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Firebase', 'NoSQL', 'Snowflake', 'BigQuery',
    'React', 'Next.js', 'Angular', 'Vue', 'Node.js', 'Express', 'Django', 'Flask', 'FastAPI', 'Spring', 'Flutter', 'Android', 'iOS',
    'HTML', 'CSS', 'Tailwind', 'REST', 'GraphQL',
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Git', 'Linux', 'CI/CD', 'Terraform', 'Jenkins',
    'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'Spark', 'Hadoop',
    'Data Analysis', 'Data Science', 'Data Visualization', 'Statistics', 'A/B Testing', 'ETL',
    'Tableau', 'Power BI', 'Excel', 'Looker', 'Google Analytics',
    'Figma', 'Photoshop', 'Illustrator', 'Canva', 'UI/UX', 'User Research', 'Prototyping',
    'SEO', 'SEM', 'Content Marketing', 'Social Media', 'Copywriting', 'Email Marketing', 'Digital Marketing', 'Brand Strategy', 'Market Research',
    'Product Management', 'Agile', 'Scrum', 'Jira', 'Roadmapping',
    'Financial Modeling', 'Accounting', 'Valuation', 'Bloomberg', 'Salesforce', 'CRM',
    'Project Management', 'Operations', 'Supply Chain', 'Consulting', 'Public Speaking', 'Research', 'Teaching',
    'Embedded Systems', 'Arduino', 'CAD', 'SolidWorks', 'AutoCAD', 'IoT', 'VLSI', 'Verilog'
  ];

  // names a job post uses that the resume reader does not need; only find() looks for these
  const JOB_EXTRA = ['Data Structures', 'Algorithms', 'System Design', 'Microservices', 'OOP', 'Generative AI', 'LLM', 'Prompt Engineering', 'Selenium', 'Postman', 'Kafka', 'RabbitMQ', 'Airflow', 'Power Query', 'DAX', 'Communication', 'Problem Solving', 'Testing', 'DevOps', 'Cybersecurity', 'Networking', 'Blockchain', 'Unity', 'React Native', 'Spring Boot', 'ASP.NET', '.NET', 'Elasticsearch', 'GitHub', 'Hugging Face', 'LangChain', 'OpenCV', 'Matplotlib', 'Statistics'];

  // other spellings → canonical name
  const ALIASES = {
    'js': 'JavaScript', 'ecmascript': 'JavaScript', 'ts': 'TypeScript', 'reactjs': 'React', 'react.js': 'React', 'vuejs': 'Vue', 'vue.js': 'Vue', 'angularjs': 'Angular',
    'node': 'Node.js', 'nodejs': 'Node.js', 'expressjs': 'Express', 'nextjs': 'Next.js', 'golang': 'Go', 'cpp': 'C++', 'c plus plus': 'C++', 'csharp': 'C#', 'dotnet': '.NET',
    'postgres': 'PostgreSQL', 'postgre sql': 'PostgreSQL', 'mongo': 'MongoDB', 'mongo db': 'MongoDB', 'my sql': 'MySQL',
    'ml': 'Machine Learning', 'dl': 'Deep Learning', 'natural language processing': 'NLP', 'gen ai': 'Generative AI', 'genai': 'Generative AI', 'large language models': 'LLM', 'llms': 'LLM',
    'k8s': 'Kubernetes', 'amazon web services': 'AWS', 'google cloud': 'GCP', 'google cloud platform': 'GCP', 'microsoft azure': 'Azure', 'cicd': 'CI/CD', 'ci cd': 'CI/CD', 'github actions': 'CI/CD',
    'sklearn': 'scikit-learn', 'scikit learn': 'scikit-learn', 'powerbi': 'Power BI', 'ms excel': 'Excel', 'microsoft excel': 'Excel', 'advanced excel': 'Excel',
    'dsa': 'Data Structures', 'data structure': 'Data Structures', 'algorithm': 'Algorithms', 'object oriented programming': 'OOP', 'object-oriented programming': 'OOP', 'object oriented': 'OOP',
    'restful': 'REST', 'rest api': 'REST', 'rest apis': 'REST', 'restful apis': 'REST', 'ui ux': 'UI/UX', 'ux': 'UI/UX', 'ui design': 'UI/UX', 'spring boot': 'Spring Boot',
    'ab testing': 'A/B Testing', 'a b testing': 'A/B Testing', 'pm': 'Product Management', 'search engine optimization': 'SEO', 'communication skills': 'Communication', 'problem-solving': 'Problem Solving',
    'unit testing': 'Testing', 'test automation': 'Testing', 'qa': 'Testing', 'cyber security': 'Cybersecurity', 'information security': 'Cybersecurity'
  };

  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const BOUND = (core, flags) => new RegExp(`(?<![A-Za-z0-9+#.])${core}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`, flags);
  const CANON = new Map();
  [...SKILL_VOCAB, ...JOB_EXTRA].forEach(s => CANON.set(s.toLowerCase(), s));
  Object.keys(ALIASES).forEach(k => CANON.set(k, ALIASES[k]));
  const canonical = (name) => CANON.get(String(name == null ? '' : name).trim().toLowerCase()) || String(name == null ? '' : name).trim();

  // ONE-LETTER and very common words need context; everything else is a plain whole-word match
  const SPECIAL = {
    'C': /(?<![A-Za-z0-9+#.])C(?:\/C\+\+|,\s*C\+\+)|(?<![A-Za-z0-9+#.])C\s+(?:programming|language)|\bprogramming in C\b|(?<![A-Za-z0-9+#.])C\s*&\s*C\+\+/u,
    'R': /(?<![A-Za-z0-9+#.])R\s+(?:programming|language|studio)\b|\bRStudio\b|\bprogramming in R\b|(?<![A-Za-z0-9+#.])R,\s*(?:Python|SQL|SAS|Stata)|(?:Python|SQL|SAS|Stata),\s*R(?![A-Za-z0-9+#])/u,
    'Go': /(?<![A-Za-z0-9+#.])(?:Golang|Go)\s+(?:programming|language|developer|services?|microservices)|\bGolang\b|(?:Python|Java|Rust|C\+\+),\s*Go(?![A-Za-z0-9+#])|(?<![A-Za-z0-9+#.])Go,\s*(?:Python|Java|Rust|C\+\+)/u,
    'Research': /\b(?:user|market|clinical|academic)\s+research\b/i,
    'Operations': /\boperations\s+(?:management|research|analyst)\b/i,
    'Teaching': /\bteaching\s+(?:assistant|experience)\b/i,
    'Networking': /\b(?:computer\s+)?networking\s+(?:protocols?|fundamentals|concepts)\b|\bTCP\/IP\b/i,
    'Testing': /\b(?:software\s+)?testing\b|\bunit tests?\b|\bQA\b/i,
    'Communication': /\b(?:written|verbal|strong|excellent|good)?\s*communication(?:\s+skills)?\b/i,
    'Spring': /\bSpring(?:\s+(?:Boot|MVC|framework))?\b/u,
    'Express': /\bExpress(?:\.js|JS)\b|\bExpress\s+(?:framework|server)\b/u,
    'Swift': /\bSwift(?:UI)?\b(?!\s+(?:response|action|delivery))/u,
    'Excel': /\b(?:MS |Microsoft |Advanced )?Excel\b(?!lent)/u
  };

  const PATTERNS = [];
  const seen = new Set();
  [...SKILL_VOCAB, ...JOB_EXTRA].forEach(skill => {
    if (seen.has(skill)) return; seen.add(skill);
    const spellings = [skill, ...Object.keys(ALIASES).filter(k => ALIASES[k] === skill)];
    if (SPECIAL[skill]) { PATTERNS.push({ skill, re: SPECIAL[skill], plain: false }); return; }
    const core = spellings.sort((a, b) => b.length - a.length).map(escRe).map(x => x.replace(/\\ /g, '[\\s-]')).join('|');
    PATTERNS.push({ skill, re: BOUND(`(?:${core})`, skill.length <= 3 && /^[A-Z+#.]+$/.test(skill) ? 'u' : 'iu'), plain: true });
  });
  PATTERNS.sort((a, b) => b.skill.length - a.skill.length);

  function find(text) {
    const t = String(text == null ? '' : text);
    const out = new Map();
    for (const { skill, re } of PATTERNS) {
      const m = t.match(re);
      if (m && !out.has(skill)) out.set(skill, { skill, literal: m[0].trim().replace(/^[^\w+#.]+|[^\w+#.]+$/g, '') || skill });
    }
    return [...out.values()];
  }

  const has = (text, skill) => { const want = canonical(skill); return find(text).some(x => x.skill === want); };

  return { SKILL_VOCAB, JOB_EXTRA, ALIASES, canonical, find, has };
});
