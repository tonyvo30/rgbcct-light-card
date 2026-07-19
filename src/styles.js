export function addStyles(card) {

const style =
document.createElement("style");


style.textContent = `

.card {
 padding:16px;
}

.compact-card {

 display:flex;
 align-items:center;
 padding:12px;

}

`;

card.appendChild(style);

}