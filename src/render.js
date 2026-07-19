export function renderCard(card) {

  if (card.compact) {

    card.innerHTML = `

    <ha-card>

      <div class="compact-card">

        <ha-icon id="icon"></ha-icon>

        <span id="name"></span>

        <span id="summary"></span>

      </div>

    </ha-card>

    `;

  }

  else {

    card.innerHTML = `

    <ha-card>

      <div class="card">

        ...

      </div>

    </ha-card>

    `;

  }

}