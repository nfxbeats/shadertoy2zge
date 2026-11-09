// Update these values together when releasing a new converter version.
const CONVERTER_RELEASE = Object.freeze({
    version: '2.1.2',
    date: '2026-11-09',
});

const converterReleaseDate = new Date(`${CONVERTER_RELEASE.date}T00:00:00Z`)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

document.querySelectorAll('[data-converter-release]').forEach(element => {
    element.textContent = `v${CONVERTER_RELEASE.version} · Released ${converterReleaseDate}`;
});
